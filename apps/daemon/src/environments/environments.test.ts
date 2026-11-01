import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, ApiErrorBody, Environment, LiveVersionSourceListResponse, LiveVersionsResponse, Project } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/platform'
import type { AuthStrategy } from '../auth'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { environments } from '../db/schema'
import { deploymentsRoutes } from '../deployments/definition'
import { createPluginTypeRegistry, PLUGIN_TYPES } from '../plugins'
import { createProject, deleteProject } from '../projects/projects'
import { lockedSecretsStore } from '../secrets'
import { openTestDatabase } from '../testing'
import { CUSTOM_ENDPOINT_SOURCE } from './custom-endpoint'
import { json, startFakeEndpoint, unreachableUrl, type FakeEndpoint } from './fake-endpoint'
import { createEnvironment, listEnvironments, readLiveVersions } from './service'
import { createLiveVersionSourceRegistry, defineLiveVersionSource, LiveVersionSourceError, type LiveVersionDeps, type LiveVersionSource } from './sources'

let database: PlatformDatabase
let root: string
let endpoint: FakeEndpoint
beforeAll(async () => {
  endpoint = await startFakeEndpoint((req, res) => {
    if (req.url === '/api/debug') return json(res, { commit: 'a1b2c3d', branch: 'main', buildStartedAt: '2026-10-27T00:00:00Z', siteUrl: 'https://shop.example.com' })
    json(res, {}, 404)
  })
})
afterAll(() => endpoint.close())
beforeEach(() => {
  database = openTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-environments-'))
  mkdirSync(join(root, '.beads'))
})
afterEach(() => {
  database.close()
  rmSync(root, { recursive: true, force: true })
})

const instanceDeps = () => ({ db: database.db, pluginTypes: createPluginTypeRegistry(PLUGIN_TYPES), secrets: lockedSecretsStore().writeOnly })
const project = (name: string): Promise<Project> => createProject(database.db, { name, source: { kind: 'local-path', path: root } })

function app(roles = ['admin']) {
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createTestApp({ db: database.db, paths: dataPaths('/unused'), auth, runtime: deploymentsRoutes(lockedSecretsStore()) })
}
const call = (method: string, path: string, body?: unknown, roles?: string[]) =>
  app(roles).request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error

const mapping = { versionPath: 'commit', branchPath: 'branch', deployedAtPath: 'buildStartedAt', linkPath: 'siteUrl' }
const production = () => ({ name: 'Production', liveSourceKind: 'custom-endpoint', liveSourceSettings: { url: endpoint.url('/api/debug'), ...mapping } })

describe('live-version sources', () => {
  it('lists the custom endpoint source with its fields to any signed-in actor', async () => {
    const res = await call('GET', '/live-version-sources', undefined, ['viewer'])
    expect(res.status).toBe(200)
    const { sources } = await res.json() as LiveVersionSourceListResponse
    expect(sources.map(s => s.id)).toEqual(['custom-endpoint', 'netlify', 'heroku'])
    expect(sources[0]!.fields.map(f => [f.name, f.required ?? false])).toEqual([
      ['url', true], ['versionPath', false], ['branchPath', false], ['deployedAtPath', false], ['linkPath', false],
    ])
    expect(sources[0]).not.toHaveProperty('read')
    expect(sources.map(s => s.plugin ?? null)).toEqual([null, 'netlify', 'heroku'])
  })

  it('refuses a bad definition or a duplicate id at registration', () => {
    const bad = (patch: Partial<LiveVersionSource>) => () => defineLiveVersionSource({ ...CUSTOM_ENDPOINT_SOURCE, ...patch } as LiveVersionSource)
    expect(bad({ id: 'Custom' })).toThrow(LiveVersionSourceError)
    expect(bad({ description: '' })).toThrow(/label and description/)
    expect(bad({ read: undefined as never })).toThrow(/read must be a function/)
    expect(bad({ fields: [{ kind: 'string', name: 'a', label: 'A' }, { kind: 'string', name: 'a', label: 'A' }] })).toThrow(/duplicate field/)
    expect(bad({ fields: [{ kind: 'string', name: 'a_b', label: 'A' }] })).toThrow(/invalid field name/)
    expect(bad({ fields: [{ kind: 'integer', name: 'a', label: 'A', min: 3, max: 1 }] })).toThrow(/min above max/)
    expect(() => createLiveVersionSourceRegistry([CUSTOM_ENDPOINT_SOURCE, CUSTOM_ENDPOINT_SOURCE])).toThrow(/Duplicate live-version source id/)
  })
})

describe('environments', () => {
  it('creates, reads, updates and deletes an environment through the API', async () => {
    const { slug } = await project('Shop')
    const created = await call('POST', `/projects/${slug}/environments`, production())
    expect(created.status).toBe(201)
    const { environment } = await created.json() as { environment: Environment }
    expect(environment).toMatchObject({ name: 'Production', liveSourceKind: 'custom-endpoint', deployKind: null, deploySettings: null })
    expect(environment.liveSourceSettings).toEqual({ url: endpoint.url('/api/debug'), ...mapping })

    expect((await (await call('GET', `/projects/${slug}/environments`, undefined, ['viewer'])).json() as { environments: Environment[] }).environments).toEqual([environment])
    expect((await call('GET', `/projects/${slug}/environments/${environment.id}`, undefined, ['viewer'])).status).toBe(200)

    const renamed = await call('PATCH', `/projects/${slug}/environments/${environment.id}`, { name: 'Live', liveSourceSettings: { url: 'https://example.com/v', versionPath: 'version' } })
    expect(renamed.status).toBe(200)
    expect((await renamed.json() as { environment: Environment })).toMatchObject({ environment: { name: 'Live', liveSourceSettings: { url: 'https://example.com/v', versionPath: 'version' } } })

    expect((await call('DELETE', `/projects/${slug}/environments/${environment.id}`)).status).toBe(204)
    expect((await call('GET', `/projects/${slug}/environments/${environment.id}`)).status).toBe(404)
  })

  it('rejects bad input with the right codes', async () => {
    const { slug } = await project('Shop')
    const post = (body: unknown, roles?: string[]) => call('POST', `/projects/${slug}/environments`, body, roles)

    expect((await post(production(), ['viewer'])).status).toBe(403)
    expect(await errorOf(await post({ liveSourceKind: 'custom-endpoint' }))).toMatchObject({ code: 'invalid_request' })
    expect(await errorOf(await post({ ...production(), liveSourceKind: 'vercel' }))).toMatchObject({ code: 'unknown_source', message: expect.stringMatching(/custom-endpoint/) })
    expect(await errorOf(await post({ ...production(), liveSourceSettings: { versionPath: 'commit' } }))).toMatchObject({ code: 'invalid_settings', message: 'url: Endpoint URL is required.' })
    expect(await errorOf(await post({ ...production(), liveSourceSettings: { url: 'https://example.com', versionPath: 'a[' } }))).toMatchObject({ code: 'invalid_settings', message: expect.stringMatching(/^versionPath: /) })
    expect(await errorOf(await post({ ...production(), liveSourceSettings: { url: 'https://example.com' } }))).toMatchObject({ code: 'invalid_settings', message: expect.stringMatching(/Map at least one/) })
    expect(await errorOf(await post({ ...production(), liveSourceSettings: { url: 'https://example.com', versionPath: 'v', extra: 1 } }))).toMatchObject({ code: 'invalid_settings', message: 'extra: Unknown option.' })

    expect((await post(production())).status).toBe(201)
    expect(await errorOf(await post({ ...production(), name: 'production' }))).toMatchObject({ code: 'name_taken' })
    expect((await call('GET', '/projects/nope/environments')).status).toBe(404)
  })

  it('keeps environments per project and removes them with the project', async () => {
    const shop = await project('Shop')
    const blog = await project('Blog')
    const settings = { url: 'https://example.com/v', versionPath: 'version' }
    const env = createEnvironment(instanceDeps(), shop.id, { name: 'Production', liveSourceKind: 'custom-endpoint', liveSourceSettings: settings })
    createEnvironment(instanceDeps(), blog.id, { name: 'Production', liveSourceKind: 'custom-endpoint', liveSourceSettings: settings })
    expect((await call('GET', `/projects/${blog.slug}/environments/${env.id}`)).status).toBe(404)

    deleteProject(database.db, shop.slug)
    expect(listEnvironments(database.db, shop.id)).toEqual([])
    expect(listEnvironments(database.db, blog.id)).toHaveLength(1)
  })
})

describe('live versions', () => {
  it('renders the four fields per environment and confines an unreachable endpoint to its own entry', async () => {
    const { slug } = await project('Shop')
    await call('POST', `/projects/${slug}/environments`, production())
    await call('POST', `/projects/${slug}/environments`, { name: 'Staging', liveSourceKind: 'custom-endpoint', liveSourceSettings: { url: await unreachableUrl(), ...mapping } })
    await call('POST', `/projects/${slug}/environments`, { name: 'Preview', liveSourceKind: 'custom-endpoint', liveSourceSettings: { url: endpoint.url('/missing'), ...mapping } })

    const res = await call('GET', `/projects/${slug}/live-versions`, undefined, ['viewer'])
    expect(res.status).toBe(200)
    const { environments } = await res.json() as LiveVersionsResponse
    expect(environments.map(e => e.environmentName)).toEqual(['Production', 'Staging', 'Preview'])
    expect(environments[0]).toMatchObject({
      liveSourceKind: 'custom-endpoint',
      live: { ok: true, version: { version: 'a1b2c3d', branch: 'main', deployedAt: '2026-10-27T00:00:00.000Z', link: 'https://shop.example.com/' } },
    })
    expect(environments[1]!.live).toEqual({ ok: false, error: expect.stringMatching(/^Could not reach 127\.0\.0\.1:\d+: ECONNREFUSED\.$/) })
    expect(environments[2]!.live).toEqual({ ok: false, error: expect.stringMatching(/returned HTTP 404/) })
    expect(environments.every(e => !Number.isNaN(Date.parse(e.checkedAt)))).toBe(true)
  })

  it('reports a source that throws, hangs or is no longer registered against that environment only', async () => {
    const shop = await project('Shop')
    const fixed = defineLiveVersionSource({ id: 'fixed', label: 'Fixed', description: 'Test.', fields: [], read: async () => ({ version: ' v1 ', link: 'not a url', deployedAt: 'nope' }) })
    const broken = defineLiveVersionSource({ id: 'broken', label: 'Broken', description: 'Test.', fields: [], read: async () => { throw new Error('vendor said no') } })
    const sources = createLiveVersionSourceRegistry([fixed, broken])
    for (const [name, kind] of [['A', 'fixed'], ['B', 'broken']] as const) createEnvironment(instanceDeps(), shop.id, { name, liveSourceKind: kind }, sources)
    database.db.update(environments).set({ liveSourceKind: 'retired' }).where(eq(environments.name, 'B')).run()
    createEnvironment(instanceDeps(), shop.id, { name: 'C', liveSourceKind: 'broken' }, sources)

    const deps: LiveVersionDeps = { ...instanceDeps(), secretsReader: lockedSecretsStore() }
    const result = await readLiveVersions(deps, shop, { sources })
    expect(result.map(r => [r.environmentName, r.live])).toEqual([
      ['A', { ok: true, version: { version: 'v1' } }],
      ['B', { ok: false, error: 'The live-version source "retired" is not available.' }],
      ['C', { ok: false, error: 'vendor said no' }],
    ])

    const hang = defineLiveVersionSource({ id: 'hang', label: 'Hang', description: 'Test.', fields: [], read: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) })
    const slow = createLiveVersionSourceRegistry([hang])
    const other = await project('Other')
    createEnvironment(instanceDeps(), other.id, { name: 'Slow', liveSourceKind: 'hang' }, slow)
    expect((await readLiveVersions(deps, other, { sources: slow, timeoutMs: 50 }))[0]!.live).toEqual({ ok: false, error: 'No answer within 0.05s.' })
  })
})
