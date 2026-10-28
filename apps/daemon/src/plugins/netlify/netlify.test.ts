import { pluginTypeInfo } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPlatform } from '../../platform'
import { createTempDataDir } from '../../testing'
import { checkPluginHealth } from '../health'
import { createPluginTypeRegistry } from '../registry'
import { PLUGIN_TYPES } from '../types'
import { createNetlifyOperations, netlifyConfig, netlifyPluginType, NetlifyApiError } from '.'

const GOOD_TOKEN = 'nfp_good-token-123'
const SITE_ID = '3970e0fe-8564-4903-9a55-c5f8de49fb8b'
const API = 'https://api.netlify.com/api/v1'

interface Recorded { method: string, url: string, headers: Headers, signal: AbortSignal | null | undefined }

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const PUBLISHED = {
  id: 'deploy-1',
  site_id: SITE_ID,
  state: 'ready',
  context: 'production',
  branch: 'main',
  commit_ref: 'abc123def4567890abc123def4567890abc123de',
  created_at: '2026-10-20T09:58:00.000Z',
  published_at: '2026-10-20T10:00:00.000Z',
  deploy_url: 'http://deploy-1--candy.netlify.app',
  deploy_ssl_url: 'https://deploy-1--candy.netlify.app',
  ssl_url: 'https://candy.example.com',
}

const SITE = {
  id: SITE_ID,
  name: 'candy',
  url: 'http://candy.example.com',
  ssl_url: 'https://candy.example.com',
  admin_url: 'https://app.netlify.com/projects/candy',
  published_deploy: PUBLISHED,
}

/** An in-memory Netlify account owning one site; `override` answers first. */
function stubNetlify(override?: (request: Recorded) => Response | undefined) {
  const requests: Recorded[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: Recorded = { method: init.method ?? 'GET', url: String(input), headers: new Headers(init.headers), signal: init.signal }
    requests.push(request)
    return override?.(request) ?? netlify(request)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

function netlify({ url, headers }: Recorded): Response {
  if (headers.get('authorization') !== `Bearer ${GOOD_TOKEN}`) return json(401, { code: 401, message: 'Access Denied: Invalid token' })
  if (url === `${API}/sites/${SITE_ID}`) return json(200, SITE)
  if (url.startsWith(`${API}/sites/${SITE_ID}/deploys?`)) return json(200, [PUBLISHED])
  return json(404, { code: 404, message: 'Not Found' })
}

const secretsWith = (token?: string) => ({ get: () => token })
const ops = (siteId = SITE_ID, token: string | undefined = GOOD_TOKEN) => createNetlifyOperations({ siteId }, secretsWith(token))
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e)
  expect(error).toBeInstanceOf(NetlifyApiError)
  return error as NetlifyApiError
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('netlify plugin type', () => {
  it('is registered as a single-instance, project-scoped type', () => {
    expect(PLUGIN_TYPES).toContain(netlifyPluginType)
    expect(createPluginTypeRegistry(PLUGIN_TYPES).get('netlify')).toBe(netlifyPluginType)
    const info = pluginTypeInfo(netlifyPluginType)
    expect(info.scopes).toEqual(['project'])
    expect(info.singleInstance).toBe(true)
    expect(info.configFields).toEqual([expect.objectContaining({ name: 'siteId', required: true })])
    expect(info.secretFields).toEqual([expect.objectContaining({ name: 'token', required: true })])
  })

  it('validates stored config', () => {
    expect(netlifyConfig({ siteId: ` ${SITE_ID} ` })).toEqual({ siteId: SITE_ID })
    expect(netlifyConfig({ siteId: 'candy.netlify.app' })).toEqual({ siteId: 'candy.netlify.app' })
    expect(() => netlifyConfig({})).toThrow(/^Invalid Netlify config: siteId: /)
    expect(() => netlifyConfig({ siteId: 'candy/../x' })).toThrow(/^Invalid Netlify config: siteId: /)
  })

  it('boots the daemon with it registered', () => {
    const temp = createTempDataDir()
    try {
      const platform = startPlatform(temp.root)
      expect(platform.pluginTypes.ids()).toContain('netlify')
      platform.close()
    }
    finally {
      temp.cleanup()
    }
  })
})

describe('netlify health', () => {
  const health = (token?: string, siteId = SITE_ID) => checkPluginHealth(netlifyPluginType, { config: { siteId }, secrets: secretsWith(token) })

  it('is healthy when the token can read the site', async () => {
    const { requests } = stubNetlify()
    expect(await health(GOOD_TOKEN)).toEqual({ healthy: true, detail: 'Can read the site candy (https://candy.example.com).' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'GET', url: `${API}/sites/${SITE_ID}` })
    expect(requests[0]!.headers.get('authorization')).toBe(`Bearer ${GOOD_TOKEN}`)
    expect(requests[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('is unhealthy with Netlify\'s reason for a wrong token', async () => {
    stubNetlify()
    expect(await health('nfp_wrong')).toEqual({ healthy: false, reason: `Netlify returned 401 for site ${SITE_ID}: Access Denied: Invalid token (the token is invalid or has expired)` })
  })

  it('is unhealthy for a site the token cannot see', async () => {
    stubNetlify()
    expect(await health(GOOD_TOKEN, 'someone-else')).toEqual({ healthy: false, reason: 'Netlify returned 404 for site someone-else: Not Found (check the site ID and that the token\'s account can see the site)' })
  })

  it('is unhealthy without calling Netlify when no token is set', async () => {
    const { fetchMock } = stubNetlify()
    expect(await health()).toEqual({ healthy: false, reason: `No Netlify token is set for site ${SITE_ID}.` })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('redacts the token from errors', async () => {
    stubNetlify(() => {
      throw new TypeError(`fetch failed: Authorization: Bearer ${GOOD_TOKEN}`)
    })
    expect(await health(GOOD_TOKEN)).toEqual({ healthy: false, reason: 'Could not reach Netlify: fetch failed: Authorization: Bearer [redacted]' })
    stubNetlify(() => json(400, { message: `bad token ${GOOD_TOKEN}` }))
    const error = await failure(ops().getSite())
    expect(error).toMatchObject({ code: 'api_error', status: 400 })
    expect(error.message).not.toContain(GOOD_TOKEN)
    expect(error.message).toContain('[redacted]')
  })
})

describe('netlify operations', () => {
  it('reads the site', async () => {
    stubNetlify()
    expect(await ops().getSite()).toEqual({ id: SITE_ID, name: 'candy', url: 'https://candy.example.com', adminUrl: 'https://app.netlify.com/projects/candy' })
  })

  it('returns the published production deploy from the site', async () => {
    const { requests } = stubNetlify()
    expect(await ops().getCurrentDeploy()).toEqual({
      id: 'deploy-1',
      state: 'ready',
      commitSha: PUBLISHED.commit_ref,
      branch: 'main',
      deployedAt: '2026-10-20T10:00:00.000Z',
      deployUrl: 'https://deploy-1--candy.netlify.app',
    })
    expect(requests.map(r => r.url)).toEqual([`${API}/sites/${SITE_ID}`])
  })

  it('falls back to the newest ready production deploy when the site omits it', async () => {
    const { requests } = stubNetlify(({ url }) => (url === `${API}/sites/${SITE_ID}` ? json(200, { ...SITE, published_deploy: null }) : undefined))
    expect(await ops().getCurrentDeploy()).toMatchObject({ id: 'deploy-1', commitSha: PUBLISHED.commit_ref, branch: 'main' })
    expect(requests.map(r => r.url)).toEqual([`${API}/sites/${SITE_ID}`, `${API}/sites/${SITE_ID}/deploys?production=true&state=ready&per_page=1`])
  })

  it('returns null when the site has never published', async () => {
    stubNetlify(({ url }) => {
      if (url === `${API}/sites/${SITE_ID}`) return json(200, { ...SITE, published_deploy: null })
      return url.includes('/deploys?') ? json(200, []) : undefined
    })
    expect(await ops().getCurrentDeploy()).toBeNull()
  })

  it('leaves commit fields null for a deploy without a commit', async () => {
    stubNetlify(() => json(200, { ...SITE, published_deploy: { id: 'deploy-2', state: 'ready', commit_ref: null, branch: null, published_at: null, created_at: '2026-10-21T08:00:00Z', deploy_url: 'http://deploy-2--candy.netlify.app' } }))
    expect(await ops().getCurrentDeploy()).toEqual({ id: 'deploy-2', state: 'ready', commitSha: null, branch: null, deployedAt: '2026-10-21T08:00:00.000Z', deployUrl: 'http://deploy-2--candy.netlify.app' })
  })

  it('accepts the site domain as the id', async () => {
    const { requests } = stubNetlify(() => json(200, { ...SITE, id: 'x' }))
    await ops('candy.netlify.app').getSite()
    expect(requests[0]!.url).toBe(`${API}/sites/candy.netlify.app`)
  })

  it('reports rate limits with the retry delay', async () => {
    stubNetlify(() => json(429, { message: 'Too Many Requests' }, { 'retry-after': '30' }))
    expect(await failure(ops().getSite())).toMatchObject({ code: 'rate_limited', status: 429, retryAfterSeconds: 30, message: `Netlify returned 429 for site ${SITE_ID}: Too Many Requests (retry in 30 s)` })
  })

  it('reports server failures and malformed responses', async () => {
    stubNetlify(() => new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' }))
    expect(await failure(ops().getSite())).toMatchObject({ code: 'unavailable', status: 502, message: `Netlify returned 502 for site ${SITE_ID}: Bad Gateway` })
    stubNetlify(() => new Response('<html>oops</html>', { status: 200 }))
    expect(await failure(ops().getSite())).toMatchObject({ code: 'invalid_response' })
    stubNetlify(() => json(200, { ...SITE, published_deploy: { state: 'ready' } }))
    expect(await failure(ops().getCurrentDeploy())).toMatchObject({ code: 'invalid_response' })
  })

  it('accepts an injected fetch', async () => {
    const fetchImpl = vi.fn(async () => json(200, SITE))
    const operations = createNetlifyOperations({ siteId: SITE_ID }, secretsWith(GOOD_TOKEN), { fetch: fetchImpl as unknown as typeof fetch })
    expect((await operations.getSite()).name).toBe('candy')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rethrows an abort unchanged', async () => {
    stubNetlify(({ signal }) => {
      expect(signal?.aborted).toBe(true)
      throw new DOMException('aborted', 'AbortError')
    })
    const controller = new AbortController()
    controller.abort()
    const operations = createNetlifyOperations({ siteId: SITE_ID }, secretsWith(GOOD_TOKEN), { signal: controller.signal })
    await expect(operations.getCurrentDeploy()).rejects.toMatchObject({ name: 'AbortError' })
  })
})
