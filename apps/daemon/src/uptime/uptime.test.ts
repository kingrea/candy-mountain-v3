import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, ApiErrorBody, ModuleId, Monitor, MonitorSourceListResponse, Project } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { CAPABILITIES, createCapabilityRegistry } from '../capabilities'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { setGrant } from '../grants/grants'
import { addRole } from '../grants/test-access'
import { createModuleRegistry, MODULES } from '../modules'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject, deleteProject } from '../projects/projects'
import { openTestDatabase } from '../testing'
import { HTTP_SOURCE, MONITOR_SOURCE_REGISTRY } from './builtin-sources'
import { MonitorError } from './errors'
import { createMonitor, listEnabledMonitors, listMonitors, updateMonitor } from './service'
import { createMonitorSourceRegistry, defineMonitorSource, MonitorSourceError, type MonitorSource } from './sources'

let database: PlatformDatabase
let root: string
beforeEach(() => {
  database = openTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-uptime-'))
  mkdirSync(join(root, '.beads'))
})
afterEach(() => {
  database.close()
  rmSync(root, { recursive: true, force: true })
})

async function project(name: string, modules: ModuleId[] = ['operations']): Promise<Project> {
  const created = await createProject(database.db, { name, source: { kind: 'local-path', path: root } })
  setEnabledModules(database.db, created.id, modules)
  return created
}

function grant(role: string, rung: string) {
  const capabilities = createCapabilityRegistry(CAPABILITIES)
  setGrant({ db: database.db, capabilities, modules: createModuleRegistry(MODULES, capabilities) }, { role, target: { kind: 'capability', id: 'uptime' }, rungs: { uptime: rung } })
}

function app(roles = ['admin']) {
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createApp({ db: database.db, paths: dataPaths('/unused'), auth })
}
const call = (method: string, path: string, body?: unknown, roles?: string[]) =>
  app(roles).request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const errorCode = async (res: Response) => ((await res.json()) as ApiErrorBody).error.code

const http = { name: 'API', sourceType: 'http', target: 'https://example.com/health', intervalSeconds: 60, options: { expectedStatus: 204 } }

function thrownCode(fn: () => unknown): string | undefined {
  try {
    fn()
  }
  catch (error) {
    if (error instanceof MonitorError) return error.code
    throw error
  }
  return undefined
}

describe('monitor sources', () => {
  it('registers the four built-in sources with their option fields', async () => {
    const res = await call('GET', '/monitor-sources', undefined, ['viewer'])
    expect(res.status).toBe(200)
    const { sources } = await res.json() as MonitorSourceListResponse
    expect(sources.map(s => s.id)).toEqual(['http', 'statuspage', 'statusio', 'statping'])
    const fieldsOf = (id: string) => sources.find(s => s.id === id)!.fields.map(f => [f.name, f.kind, f.required ?? false])
    expect(fieldsOf('http')).toEqual([['expectedStatus', 'integer', false], ['responseContains', 'string', false]])
    expect(fieldsOf('statuspage')).toEqual([['componentId', 'string', true]])
    expect(fieldsOf('statusio')).toEqual([['componentId', 'string', true], ['containerId', 'string', true]])
    expect(fieldsOf('statping')).toEqual([['serviceId', 'integer', true]])
    expect(sources.every(s => s.label && s.description && s.targetLabel)).toBe(true)
    expect(sources.every(s => !('check' in s))).toBe(true)
    expect(MONITOR_SOURCE_REGISTRY.list().every(s => typeof s.check === 'function')).toBe(true)
  })

  it('refuses a bad definition or a duplicate id', () => {
    const bad = (patch: Partial<MonitorSource>) => () => defineMonitorSource({ ...HTTP_SOURCE, ...patch } as MonitorSource)
    expect(bad({ id: 'Bad Id' })).toThrow(MonitorSourceError)
    expect(bad({ label: ' ' })).toThrow(/label/)
    expect(bad({ check: undefined })).toThrow(/check must be a function/)
    expect(bad({ fields: [{ kind: 'string', name: 'a', label: 'A' }, { kind: 'string', name: 'a', label: 'A' }] })).toThrow(/duplicate field/)
    expect(bad({ fields: [{ kind: 'string', name: 'a-b', label: 'A' }] })).toThrow(/invalid field name/)
    expect(bad({ fields: [{ kind: 'number', name: 'a', label: 'A' } as never] })).toThrow(/unknown kind/)
    expect(bad({ fields: [{ kind: 'string', name: 'a', label: 'A', pattern: '(' }] })).toThrow(/invalid pattern/)
    expect(bad({ fields: [{ kind: 'integer', name: 'a', label: 'A', min: 5, max: 1 }] })).toThrow(/min above max/)
    expect(bad({ fields: [{ kind: 'integer', name: 'a', label: 'A', max: 10, default: 11 }] })).toThrow(/invalid default/)
    expect(() => createMonitorSourceRegistry([HTTP_SOURCE, HTTP_SOURCE])).toThrow(/Duplicate monitor source id/)
  })
})

describe('monitor service', () => {
  it('persists an HTTP monitor with its expected status and fills defaults', async () => {
    const alpha = await project('alpha')
    const monitor = createMonitor(database.db, alpha.id, http)
    expect(monitor).toMatchObject({ name: 'API', sourceType: 'http', intervalSeconds: 60, enabled: true, options: { expectedStatus: 204 } })
    expect(listMonitors(database.db, alpha.id)).toEqual([monitor])
    const defaulted = createMonitor(database.db, alpha.id, { name: 'Home', sourceType: 'http', target: 'http://localhost:3000/' })
    expect(defaulted).toMatchObject({ intervalSeconds: 60, options: { expectedStatus: 200 } })
  })

  it('validates options against the source type', async () => {
    const alpha = await project('alpha')
    const make = (sourceType: string, options: Record<string, unknown>) => () => createMonitor(database.db, alpha.id, { ...http, sourceType, options })
    expect(thrownCode(make('ftp', {}))).toBe('unknown_source')
    expect(thrownCode(make('http', { expectedStatus: 99 }))).toBe('invalid_options')
    expect(thrownCode(make('http', { expectedStatus: 200.5 }))).toBe('invalid_options')
    expect(thrownCode(make('http', { extra: 1 }))).toBe('invalid_options')
    expect(thrownCode(make('statuspage', {}))).toBe('invalid_options')
    expect(thrownCode(make('statuspage', { componentId: 'has spaces' }))).toBe('invalid_options')
    expect(thrownCode(make('statusio', { componentId: 'abc' }))).toBe('invalid_options')
    expect(thrownCode(make('statping', { serviceId: -1 }))).toBe('invalid_options')
    expect(make('statping', { serviceId: '7' })().options).toEqual({ serviceId: 7 })
    expect(make('statusio', { componentId: ' abc ', containerId: 'def' })().options).toEqual({ componentId: 'abc', containerId: 'def' })
    expect(make('http', { responseContains: ' ok ' })().options).toEqual({ expectedStatus: 200, responseContains: 'ok' })
  })

  it('revalidates options when the source type changes, and lists enabled monitors', async () => {
    const alpha = await project('alpha')
    const monitor = createMonitor(database.db, alpha.id, http)
    expect(thrownCode(() => updateMonitor(database.db, alpha.id, monitor.id, { sourceType: 'statuspage' }))).toBe('invalid_options')
    const moved = updateMonitor(database.db, alpha.id, monitor.id, { sourceType: 'statuspage', options: { componentId: 'abc123' } })
    expect(moved).toMatchObject({ sourceType: 'statuspage', options: { componentId: 'abc123' }, target: http.target })
    updateMonitor(database.db, alpha.id, monitor.id, { enabled: false })
    expect(listEnabledMonitors(database.db)).toEqual([])
  })

  it('is removed with its project', async () => {
    const alpha = await project('alpha')
    createMonitor(database.db, alpha.id, http)
    deleteProject(database.db, 'alpha')
    expect(listMonitors(database.db, alpha.id)).toEqual([])
  })

  it('accepts a custom registry', async () => {
    const alpha = await project('alpha')
    const ping = defineMonitorSource({ id: 'ping', label: 'Ping', description: 'Pings.', targetLabel: 'Host', fields: [], check: HTTP_SOURCE.check })
    const sources = createMonitorSourceRegistry([ping])
    expect(createMonitor(database.db, alpha.id, { ...http, sourceType: 'ping', options: {} }, sources).sourceType).toBe('ping')
    expect(MONITOR_SOURCE_REGISTRY.has('ping')).toBe(false)
  })
})

describe('monitor routes', () => {
  it('creates, reads, updates, toggles and deletes a monitor', async () => {
    await project('alpha')
    const created = await call('POST', '/projects/alpha/monitors', { ...http, name: ' API ' })
    expect(created.status).toBe(201)
    const { monitor } = await created.json() as { monitor: Monitor }
    expect(monitor).toMatchObject({ name: 'API', sourceType: 'http', target: http.target, intervalSeconds: 60, enabled: true, options: { expectedStatus: 204 } })

    const listed = await (await call('GET', '/projects/alpha/monitors')).json() as { monitors: Monitor[] }
    expect(listed.monitors).toEqual([monitor])
    expect((await call('GET', `/projects/alpha/monitors/${monitor.id}`)).status).toBe(200)

    const patched = await call('PATCH', `/projects/alpha/monitors/${monitor.id}`, { intervalSeconds: 120, options: { expectedStatus: 200, responseContains: 'ok' } })
    expect(((await patched.json()) as { monitor: Monitor }).monitor).toMatchObject({ intervalSeconds: 120, options: { expectedStatus: 200, responseContains: 'ok' }, name: 'API' })

    const disabled = await call('POST', `/projects/alpha/monitors/${monitor.id}/disable`)
    expect(((await disabled.json()) as { monitor: Monitor }).monitor.enabled).toBe(false)
    const enabled = await call('POST', `/projects/alpha/monitors/${monitor.id}/enable`)
    expect(((await enabled.json()) as { monitor: Monitor }).monitor.enabled).toBe(true)

    expect((await call('DELETE', `/projects/alpha/monitors/${monitor.id}`)).status).toBe(204)
    expect((await call('GET', `/projects/alpha/monitors/${monitor.id}`)).status).toBe(404)
  })

  it('rejects an unknown source, a short interval and bad bodies', async () => {
    const alpha = await project('alpha')
    const unknown = await call('POST', '/projects/alpha/monitors', { ...http, sourceType: 'gopher' })
    expect(unknown.status).toBe(422)
    expect(await errorCode(unknown)).toBe('unknown_source')
    const short = await call('POST', '/projects/alpha/monitors', { ...http, intervalSeconds: 29 })
    expect(short.status).toBe(400)
    expect(((await short.json()) as ApiErrorBody).error.message).toMatch(/at least 30/)
    const options = await call('POST', '/projects/alpha/monitors', { ...http, sourceType: 'statusio', options: { componentId: 'a' } })
    expect(options.status).toBe(422)
    expect(await errorCode(options)).toBe('invalid_options')
    for (const body of [{}, { ...http, name: '' }, { ...http, target: 'ftp://x' }, { ...http, target: 'not a url' }, { ...http, intervalSeconds: '60' }, { ...http, enabled: 'yes' }, { ...http, options: [] }]) {
      expect((await call('POST', '/projects/alpha/monitors', body)).status).toBe(400)
    }
    expect((await app().request('/projects/alpha/monitors', { method: 'POST', body: '{' })).status).toBe(400)
    expect(listMonitors(database.db, alpha.id)).toEqual([])

    const { monitor } = await (await call('POST', '/projects/alpha/monitors', http)).json() as { monitor: Monitor }
    expect((await call('PATCH', `/projects/alpha/monitors/${monitor.id}`, { intervalSeconds: 10 })).status).toBe(400)
    expect(await errorCode(await call('PATCH', `/projects/alpha/monitors/${monitor.id}`, { sourceType: 'nope' }))).toBe('unknown_source')
  })

  it('gates reads on the uptime view, writes on the admin plus the manage tool, and scopes ids to the project', async () => {
    const alpha = await project('alpha')
    await project('beta')
    const monitor = createMonitor(database.db, alpha.id, http)
    const reads = ['/projects/alpha/monitors', `/projects/alpha/monitors/${monitor.id}`, '/projects/alpha/uptime/status', `/projects/alpha/monitors/${monitor.id}/checks`]
    const writes = [['POST', '/projects/alpha/monitors'], ['PATCH', `/projects/alpha/monitors/${monitor.id}`], ['DELETE', `/projects/alpha/monitors/${monitor.id}`], ['POST', `/projects/alpha/monitors/${monitor.id}/disable`], ['POST', `/projects/alpha/monitors/${monitor.id}/enable`]] as const

    for (const path of reads) expect((await call('GET', path, undefined, ['viewer'])).status).toBe(403)
    addRole(database.db, 'viewer')
    grant('viewer', 'read')
    for (const path of reads) expect((await call('GET', path, undefined, ['viewer'])).status).toBe(200)
    grant('viewer', 'manage')
    for (const [method, path] of writes) expect((await call(method, path, http, ['viewer'])).status).toBe(403)
    expect((await call('GET', '/monitor-sources', undefined, ['nobody'])).status).toBe(200)
    expect((await call('GET', `/projects/beta/monitors/${monitor.id}`)).status).toBe(404)
    expect((await call('POST', `/projects/beta/monitors/${monitor.id}/disable`)).status).toBe(404)
    expect((await call('GET', '/projects/nope/monitors')).status).toBe(404)
  })

  it('refuses reads and writes while Operations is not enabled for the project', async () => {
    const alpha = await project('alpha', [])
    const monitor = createMonitor(database.db, alpha.id, http)
    for (const res of [await call('GET', '/projects/alpha/uptime/status'), await call('POST', `/projects/alpha/monitors/${monitor.id}/disable`)]) {
      expect(res.status).toBe(404)
      expect(await errorCode(res)).toBe('not_enabled')
    }
  })
})
