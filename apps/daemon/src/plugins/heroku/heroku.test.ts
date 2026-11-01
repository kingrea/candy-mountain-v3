import { pluginTypeInfo } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTestPlatform } from '../../testing/platform'
import { createTempDataDir } from '../../testing'
import { checkPluginHealth } from '../health'
import { createPluginTypeRegistry } from '../registry'
import { PLUGIN_TYPES } from '../types'
import { createHerokuOperations, herokuConfig, herokuPluginType, HerokuApiError } from '.'

const GOOD_KEY = 'heroku-good-key-123'
const APP_ID = '01234567-89ab-cdef-0123-456789abcdef'

interface Recorded { url: string, headers: Headers, signal: AbortSignal | null | undefined }

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const release = (version: number, extra: Record<string, unknown> = {}) => ({
  id: `release-${version}`,
  version,
  description: `Deploy v${version}`,
  created_at: `2026-10-${10 + version}T12:00:00Z`,
  status: 'succeeded',
  current: false,
  slug: { id: `slug-${version}` },
  oci_image: null,
  ...extra,
})

/** One Heroku app, 'candy-mountain'; `releases` is newest first and `override` answers first. */
function stubHeroku({ releases = [release(3, { current: true }), release(2)], override }: { releases?: unknown[], override?: (request: Recorded) => Response | undefined } = {}) {
  const requests: Recorded[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: Recorded = { url: String(input), headers: new Headers(init.headers), signal: init.signal }
    requests.push(request)
    return override?.(request) ?? heroku(request, releases)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

function heroku({ url, headers }: Recorded, releases: unknown[]): Response {
  if (headers.get('authorization') !== `Bearer ${GOOD_KEY}`) return json(401, { id: 'unauthorized', message: 'Invalid credentials provided.' })
  const base = 'https://api.heroku.com/apps/candy-mountain'
  if (!url.startsWith(base)) return json(404, { id: 'not_found', message: 'Couldn\'t find that app.' })
  switch (url.slice(base.length)) {
    case '':
      return json(200, { id: APP_ID, name: 'candy-mountain', web_url: 'https://candy-mountain-abc123.herokuapp.com/' })
    case '/releases':
      return json(206, releases)
    case '/slugs/slug-3':
      return json(200, { id: 'slug-3', commit: 'a1b2c3d4e5f6', commit_description: 'Fix the thing' })
    case '/slugs/slug-2':
      return json(200, { id: 'slug-2', commit: null })
    case '/oci-images/image-4':
      return json(200, { id: 'image-4', commit: 'f00dfeed' })
    default:
      return json(404, { id: 'not_found', message: 'Not found.' })
  }
}

const secretsWith = (key?: string) => ({ get: () => key })
const ops = (key: string | undefined = GOOD_KEY, appName = 'candy-mountain') => createHerokuOperations({ appName }, secretsWith(key))
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e)
  expect(error).toBeInstanceOf(HerokuApiError)
  return error as HerokuApiError
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('heroku plugin type', () => {
  it('is registered as a single-instance, project-only type', () => {
    // The deployments definition brings it, so the product's own list leaves it out.
    expect(PLUGIN_TYPES).not.toContain(herokuPluginType)
    expect(createPluginTypeRegistry([...PLUGIN_TYPES, herokuPluginType]).get('heroku')).toBe(herokuPluginType)
    const info = pluginTypeInfo(herokuPluginType)
    expect(info.scopes).toEqual(['project'])
    expect(info.singleInstance).toBe(true)
    expect(info.configFields).toEqual([expect.objectContaining({ name: 'appName', required: true })])
    expect(info.secretFields).toEqual([expect.objectContaining({ name: 'apiKey', required: true })])
  })

  it('validates stored config', () => {
    expect(herokuConfig({ appName: ' candy-mountain ' })).toEqual({ appName: 'candy-mountain' })
    expect(() => herokuConfig({})).toThrow(/^Invalid Heroku config: appName: /)
    expect(() => herokuConfig({ appName: 'Candy Mountain' })).toThrow(/^Invalid Heroku config: appName: /)
  })

  it('boots the daemon with it registered', () => {
    const temp = createTempDataDir()
    try {
      const platform = startTestPlatform(temp.root)
      expect(platform.pluginTypes.ids()).toContain('heroku')
      platform.close()
    }
    finally {
      temp.cleanup()
    }
  })
})

describe('heroku health', () => {
  const health = (key?: string, appName = 'candy-mountain') => checkPluginHealth(herokuPluginType, { config: { appName }, secrets: secretsWith(key) })

  it('is healthy when the key can read the app', async () => {
    const { requests } = stubHeroku()
    expect(await health(GOOD_KEY)).toEqual({ healthy: true, detail: 'Can read Heroku app \'candy-mountain\'.' })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toBe('https://api.heroku.com/apps/candy-mountain')
    expect(requests[0]!.headers.get('accept')).toBe('application/vnd.heroku+json; version=3')
    expect(requests[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('is unhealthy with Heroku\'s reason for a wrong key', async () => {
    stubHeroku()
    expect(await health('heroku-wrong-key')).toEqual({
      healthy: false,
      reason: 'Heroku returned 401 for app \'candy-mountain\': Invalid credentials provided (the API key is invalid or has expired).',
    })
  })

  it('is unhealthy for an app the key cannot see', async () => {
    stubHeroku()
    expect(await health(GOOD_KEY, 'someone-else')).toEqual({
      healthy: false,
      reason: 'Heroku returned 404 for app \'someone-else\': Couldn\'t find that app (check the app name and the API key\'s access).',
    })
  })

  it('is unhealthy without calling Heroku when no key is set', async () => {
    const { fetchMock } = stubHeroku()
    expect(await health()).toEqual({ healthy: false, reason: 'No Heroku API key is set.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('redacts the key when Heroku cannot be reached', async () => {
    stubHeroku({
      override: () => {
        throw new TypeError(`fetch failed: Authorization: Bearer ${GOOD_KEY}`)
      },
    })
    expect(await health(GOOD_KEY)).toEqual({ healthy: false, reason: 'Could not reach Heroku: fetch failed: Authorization: Bearer [redacted]' })
  })
})

describe('heroku operations', () => {
  it('reads the app', async () => {
    stubHeroku()
    expect(await ops().getApp()).toEqual({ id: APP_ID, name: 'candy-mountain', webUrl: 'https://candy-mountain-abc123.herokuapp.com/' })
  })

  it('returns the current release with its slug\'s commit', async () => {
    const { requests } = stubHeroku()
    expect(await ops().getCurrentRelease()).toEqual({
      version: 3,
      commitSha: 'a1b2c3d4e5f6',
      description: 'Deploy v3',
      createdAt: '2026-10-13T12:00:00Z',
      appUrl: 'https://candy-mountain-abc123.herokuapp.com/',
      status: 'succeeded',
    })
    const releases = requests.find(r => r.url.endsWith('/releases'))!
    expect(releases.headers.get('range')).toBe('version ..; order=desc, max=10')
    expect(releases.headers.get('accept')).toBe('application/vnd.heroku+json; version=3')
    expect(requests.map(r => r.url)).toContain('https://api.heroku.com/apps/candy-mountain/slugs/slug-3')
  })

  it('skips a newer release that is not current', async () => {
    stubHeroku({ releases: [release(4, { status: 'failed' }), release(3, { current: true }), release(2)] })
    expect(await ops().getCurrentRelease()).toMatchObject({ version: 3, status: 'succeeded' })
  })

  it('falls back to the newest succeeded release when none is marked current', async () => {
    stubHeroku({ releases: [release(4, { status: 'pending' }), release(3), release(2)] })
    expect(await ops().getCurrentRelease()).toMatchObject({ version: 3 })
  })

  it('reads the commit from an OCI image', async () => {
    stubHeroku({ releases: [release(4, { current: true, slug: null, oci_image: { id: 'image-4' } })] })
    expect(await ops().getCurrentRelease()).toMatchObject({ version: 4, commitSha: 'f00dfeed' })
  })

  it('reports a null commit when the build has none or there is no build', async () => {
    stubHeroku({ releases: [release(2, { current: true })] })
    expect(await ops().getCurrentRelease()).toMatchObject({ version: 2, commitSha: null })
    const { requests } = stubHeroku({ releases: [release(1, { current: true, slug: null, description: 'Initial release' })] })
    expect(await ops().getCurrentRelease()).toMatchObject({ version: 1, commitSha: null, description: 'Initial release' })
    expect(requests.some(r => r.url.includes('/slugs/'))).toBe(false)
  })

  it('returns null for an app that has never been released', async () => {
    stubHeroku({ releases: [] })
    expect(await ops().getCurrentRelease()).toBeNull()
  })

  it('reports a wrong key with the key redacted', async () => {
    stubHeroku({ override: ({ headers }) => json(401, { id: 'unauthorized', message: `Bad key ${headers.get('authorization')}` }) })
    const error = await failure(ops('heroku-wrong-key').getCurrentRelease())
    expect(error).toMatchObject({ code: 'unauthorized', status: 401, herokuError: 'unauthorized' })
    expect(error.message).not.toContain('heroku-wrong-key')
    expect(error.message).toContain('Bearer [redacted]')
  })

  it('reports rate limits, server failures and malformed answers', async () => {
    stubHeroku({ override: () => json(429, { id: 'rate_limit', message: 'Your account reached the API rate limit.' }, { 'retry-after': '60' }) })
    expect(await failure(ops().getApp())).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60, message: 'Heroku returned 429 for app \'candy-mountain\': Your account reached the API rate limit (retry in 60 s).' })
    stubHeroku({ override: () => new Response('bad gateway', { status: 502, statusText: 'Bad Gateway' }) })
    expect(await failure(ops().getApp())).toMatchObject({ code: 'unavailable', status: 502, message: 'Heroku returned 502 for app \'candy-mountain\': Bad Gateway.' })
    stubHeroku({ override: () => new Response('<html>oops</html>', { status: 200 }) })
    expect(await failure(ops().getApp())).toMatchObject({ code: 'invalid_response' })
    stubHeroku({ override: ({ url }) => (url.endsWith('/releases') ? json(200, { not: 'a list' }) : undefined) })
    expect(await failure(ops().getCurrentRelease())).toMatchObject({ code: 'invalid_response' })
    stubHeroku({ releases: [{ version: 'three', current: true }] })
    expect(await failure(ops().getCurrentRelease())).toMatchObject({ code: 'invalid_response', message: 'Heroku sent an incomplete release for app \'candy-mountain\'.' })
  })

  it('aborts in-flight requests with the given signal', async () => {
    stubHeroku({
      override: ({ signal }) => {
        expect(signal?.aborted).toBe(true)
        throw new DOMException('aborted', 'AbortError')
      },
    })
    const controller = new AbortController()
    controller.abort()
    const operations = createHerokuOperations({ appName: 'candy-mountain' }, secretsWith(GOOD_KEY), { signal: controller.signal })
    await expect(operations.getApp()).rejects.toMatchObject({ name: 'AbortError' })
  })
})
