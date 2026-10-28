import type { ApiErrorBody, Environment, LiveVersionsResponse, Project } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_TYPES } from '../plugins'
import { createPluginInstance, deletePluginInstance, testPluginInstance, updatePluginInstance } from '../plugins/instances/instances'
import { instanceHarness, type InstanceHarness } from '../plugins/instances/test-support'

const NETLIFY_TOKEN = 'nfp_good-token-123'
const SITE_ID = 'candy-site'
const NETLIFY = `https://api.netlify.com/api/v1/sites/${SITE_ID}`
const HEROKU_KEY = 'heroku-good-key-123'
const HEROKU = 'https://api.heroku.com/apps/candy-mountain'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const PUBLISHED = {
  id: 'deploy-1',
  state: 'ready',
  branch: 'main',
  commit_ref: 'abc123def4567890abc123def4567890abc123de',
  created_at: '2026-10-20T09:58:00.000Z',
  published_at: '2026-10-20T10:00:00.000Z',
  deploy_ssl_url: 'https://deploy-1--candy.netlify.app',
}

const release = (version: number, slug: string | null, current = false) => ({
  id: `release-${version}`,
  version,
  description: `Deploy v${version}`,
  created_at: `2026-10-${10 + version}T12:00:00Z`,
  status: 'succeeded',
  current,
  slug: slug ? { id: slug } : null,
  oci_image: null,
})

const vendors = {
  publishedDeploy: PUBLISHED as Record<string, unknown> | null,
  deploys: [] as unknown[],
  releases: [release(3, 'slug-3', true), release(2, 'slug-2')] as unknown[],
}

function stubVendors() {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    urls.push(url)
    const auth = new Headers(init.headers).get('authorization')
    if (url.startsWith('https://api.netlify.com/')) {
      if (auth !== `Bearer ${NETLIFY_TOKEN}`) return json(401, { code: 401, message: 'Access Denied: Invalid token' })
      if (url === NETLIFY) return json(200, { id: SITE_ID, name: 'candy', ssl_url: 'https://candy.example.com', published_deploy: vendors.publishedDeploy })
      if (url.startsWith(`${NETLIFY}/deploys?`)) return json(200, vendors.deploys)
    }
    if (url.startsWith(HEROKU)) {
      if (auth !== `Bearer ${HEROKU_KEY}`) return json(401, { id: 'unauthorized', message: 'Invalid credentials provided.' })
      if (url === HEROKU) return json(200, { id: 'app-1', name: 'candy-mountain', web_url: 'https://candy-mountain-abc123.herokuapp.com/' })
      if (url === `${HEROKU}/releases`) return json(206, vendors.releases)
      if (url === `${HEROKU}/slugs/slug-3`) return json(200, { id: 'slug-3', commit: 'a1b2c3d4e5f6' })
      if (url === `${HEROKU}/slugs/slug-2`) return json(200, { id: 'slug-2', commit: null })
    }
    return json(404, { message: 'Not Found' })
  }))
  return urls
}

let h: InstanceHarness
let shop: Project
let urls: string[]
beforeEach(async () => {
  vendors.publishedDeploy = PUBLISHED
  vendors.deploys = []
  vendors.releases = [release(3, 'slug-3', true), release(2, 'slug-2')]
  urls = stubVendors()
  h = instanceHarness(PLUGIN_TYPES)
  shop = await h.createProject('shop')
})
afterEach(() => {
  h.close()
  vi.unstubAllGlobals()
})

const call = (method: string, path: string, body?: unknown, roles?: string[]) =>
  h.app(roles).request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error
const saveEnvironment = (name: string, liveSourceKind: string) => call('POST', `/projects/${shop.slug}/environments`, { name, liveSourceKind })
const liveVersions = async () => ((await (await call('GET', `/projects/${shop.slug}/live-versions`, undefined, ['viewer'])).json()) as LiveVersionsResponse).environments

function addNetlify(token = NETLIFY_TOKEN) {
  return createPluginInstance(h.deps, { type: 'netlify', scope: 'project', projectId: shop.id, config: { siteId: SITE_ID }, secrets: { token } })
}
function addHeroku(apiKey = HEROKU_KEY) {
  return createPluginInstance(h.deps, { type: 'heroku', scope: 'project', projectId: shop.id, config: { appName: 'candy-mountain' }, secrets: { apiKey } })
}

describe('netlify live version', () => {
  it('cannot be saved until the project has a healthy Netlify plugin', async () => {
    expect(await errorOf(await saveEnvironment('Production', 'netlify'))).toEqual({
      code: 'invalid_settings',
      message: 'The Netlify plugin is not set up for this project; add it on the Plugins page.',
    })

    const instance = addNetlify('nfp_wrong-token')
    expect(await errorOf(await saveEnvironment('Production', 'netlify'))).toMatchObject({ message: expect.stringMatching(/has not been tested since it last changed/) })

    await testPluginInstance(h.deps, instance.id)
    const refused = await saveEnvironment('Production', 'netlify')
    expect(refused.status).toBe(422)
    expect(await errorOf(refused)).toEqual({
      code: 'invalid_settings',
      message: `The Netlify plugin is unhealthy: Netlify returned 401 for site ${SITE_ID}: Access Denied: Invalid token (the token is invalid or has expired)`,
    })

    updatePluginInstance(h.deps, instance.id, { secrets: { token: NETLIFY_TOKEN } })
    await testPluginInstance(h.deps, instance.id)
    const saved = await saveEnvironment('Production', 'netlify')
    expect(saved.status).toBe(201)
    expect((await saved.json() as { environment: Environment }).environment).toMatchObject({ liveSourceKind: 'netlify', liveSourceSettings: {} })
  })

  it('shows the published deploy\'s commit, branch, time and permalink', async () => {
    await testPluginInstance(h.deps, addNetlify().id)
    expect((await saveEnvironment('Production', 'netlify')).status).toBe(201)

    expect((await liveVersions())[0]).toMatchObject({
      liveSourceKind: 'netlify',
      live: { ok: true, version: { version: PUBLISHED.commit_ref, branch: 'main', deployedAt: '2026-10-20T10:00:00.000Z', link: 'https://deploy-1--candy.netlify.app/' } },
    })
  })

  it('falls back to the site URL for a deploy without a permalink, and is empty before the first deploy', async () => {
    await testPluginInstance(h.deps, addNetlify().id)
    await saveEnvironment('Production', 'netlify')

    vendors.publishedDeploy = { id: 'deploy-2', state: 'ready', created_at: '2026-10-21T08:00:00Z' }
    expect((await liveVersions())[0]!.live).toEqual({ ok: true, version: { deployedAt: '2026-10-21T08:00:00.000Z', link: 'https://candy.example.com/' } })

    vendors.publishedDeploy = null
    expect((await liveVersions())[0]!.live).toEqual({ ok: true, version: {} })
  })

  it('reports the plugin\'s reason once the instance turns unhealthy, without calling Netlify', async () => {
    const instance = addNetlify()
    await testPluginInstance(h.deps, instance.id)
    await saveEnvironment('Production', 'netlify')

    updatePluginInstance(h.deps, instance.id, { secrets: { token: 'nfp_revoked' } })
    await testPluginInstance(h.deps, instance.id)
    const before = urls.length
    expect((await liveVersions())[0]!.live).toEqual({
      ok: false,
      error: `The Netlify plugin is unhealthy: Netlify returned 401 for site ${SITE_ID}: Access Denied: Invalid token (the token is invalid or has expired)`,
    })
    expect(urls).toHaveLength(before)

    await deletePluginInstance(h.deps, instance.id)
    expect((await liveVersions())[0]!.live).toEqual({ ok: false, error: 'The Netlify plugin is not set up for this project; add it on the Plugins page.' })
  })
})

describe('heroku live version', () => {
  it('cannot be saved without a healthy Heroku plugin, including when switching an environment to it', async () => {
    await testPluginInstance(h.deps, addNetlify().id)
    const { environment } = await (await saveEnvironment('Production', 'netlify')).json() as { environment: Environment }
    const patch = () => call('PATCH', `/projects/${shop.slug}/environments/${environment.id}`, { liveSourceKind: 'heroku' })
    expect(await errorOf(await patch())).toMatchObject({ code: 'invalid_settings', message: 'The Heroku plugin is not set up for this project; add it on the Plugins page.' })

    const instance = addHeroku('heroku-wrong-key')
    await testPluginInstance(h.deps, instance.id)
    expect(await errorOf(await saveEnvironment('Staging', 'heroku'))).toEqual({
      code: 'invalid_settings',
      message: 'The Heroku plugin is unhealthy: Heroku returned 401 for app \'candy-mountain\': Invalid credentials provided (the API key is invalid or has expired).',
    })

    updatePluginInstance(h.deps, instance.id, { secrets: { apiKey: HEROKU_KEY } })
    await testPluginInstance(h.deps, instance.id)
    expect((await patch()).status).toBe(200)
  })

  it('shows the current release\'s commit, time and app link, with no branch', async () => {
    await testPluginInstance(h.deps, addHeroku().id)
    expect((await saveEnvironment('Production', 'heroku')).status).toBe(201)

    expect((await liveVersions())[0]).toMatchObject({
      liveSourceKind: 'heroku',
      live: { ok: true, version: { version: 'a1b2c3d4e5f6', deployedAt: '2026-10-13T12:00:00.000Z', link: 'https://candy-mountain-abc123.herokuapp.com/' } },
    })
    expect((await liveVersions())[0]!.live).not.toHaveProperty('version.branch')
  })

  it('names a release without a commit by its number, and is empty for an app never released', async () => {
    await testPluginInstance(h.deps, addHeroku().id)
    await saveEnvironment('Production', 'heroku')

    vendors.releases = [release(2, 'slug-2', true)]
    expect((await liveVersions())[0]!.live).toEqual({ ok: true, version: { version: 'v2', deployedAt: '2026-10-12T12:00:00.000Z', link: 'https://candy-mountain-abc123.herokuapp.com/' } })

    vendors.releases = []
    expect((await liveVersions())[0]!.live).toEqual({ ok: true, version: {} })
  })

  it('surfaces a Heroku failure during the read against that environment only', async () => {
    await testPluginInstance(h.deps, addHeroku().id)
    await testPluginInstance(h.deps, addNetlify().id)
    await saveEnvironment('Production', 'netlify')
    await saveEnvironment('API', 'heroku')

    vendors.releases = { not: 'a list' } as never
    const [netlify, heroku] = await liveVersions()
    expect(netlify!.live.ok).toBe(true)
    expect(heroku!.live).toEqual({ ok: false, error: expect.stringMatching(/release list/) })
  })
})
