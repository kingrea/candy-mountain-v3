import type { Actor, ApiErrorBody, ModuleDefinition, Workspace, WorkspaceModulesResponse } from '@candy-mountain/platform-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, openTestDatabase } from '../testing'
import type { AuthStrategy } from '../auth'
import { createCapabilityRegistry } from '../capabilities'
import { fixtureCapability } from '../capabilities/fixtures'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { createModuleRegistry } from '../modules'
import { createWorkspace, deleteWorkspace } from '../workspaces/workspaces'
import { listEnabledModules, setEnabledModules } from './enablement'

const capabilities = createCapabilityRegistry([fixtureCapability('issues'), fixtureCapability('uptime')])
const MODULES: readonly ModuleDefinition[] = [
  { id: 'issues', label: 'Issues', description: 'Issues.', icon: 'i-lucide-list-todo', capabilities: [{ capabilityId: 'issues', defaultRung: 'read' }] },
  { id: 'agent-hub', label: 'Agent Hub', description: 'Agents.', icon: 'i-lucide-bot', capabilities: [] },
  { id: 'operations', label: 'Operations', description: 'Ops.', icon: 'i-lucide-activity', capabilities: [{ capabilityId: 'uptime', defaultRung: 'read' }] },
]
const modules = createModuleRegistry(MODULES, capabilities)

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase()
})
afterEach(() => database.close())

const workspace = async (name: string): Promise<Workspace> => createWorkspace(database.db, { name })

function app(roles = ['admin']) {
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createTestApp({ db: database.db, paths: dataPaths('/unused'), auth, capabilities, modules })
}

const put = (slug: string, body: unknown, roles?: string[]) =>
  app(roles).request(`/workspaces/${slug}/modules`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('module enablement service', () => {
  it('starts with nothing enabled', async () => {
    const alpha = await workspace('alpha')
    expect(listEnabledModules(database.db, alpha.id)).toEqual([])
  })

  it('replaces the set, enabling and disabling', async () => {
    const alpha = await workspace('alpha')
    expect(setEnabledModules(database.db, alpha.id, ['operations', 'issues'])).toEqual(['issues', 'operations'])
    expect(setEnabledModules(database.db, alpha.id, ['operations', 'agent-hub', 'agent-hub'])).toEqual(['agent-hub', 'operations'])
    expect(setEnabledModules(database.db, alpha.id, [])).toEqual([])
    expect(listEnabledModules(database.db, alpha.id)).toEqual([])
  })

  it('orders by the module registry and drops modules it no longer registers', async () => {
    const alpha = await workspace('alpha')
    expect(setEnabledModules(database.db, alpha.id, ['operations', 'retired', 'agent-hub'], modules)).toEqual(['agent-hub', 'operations'])
    expect(listEnabledModules(database.db, alpha.id)).toEqual(['agent-hub', 'operations', 'retired'])
    setEnabledModules(database.db, alpha.id, ['operations', 'issues'])
    expect(listEnabledModules(database.db, alpha.id, modules)).toEqual(['issues', 'operations'])
  })

  it('keeps workspaces independent and cascades on workspace delete', async () => {
    const [alpha, beta] = [await workspace('alpha'), await workspace('beta')]
    setEnabledModules(database.db, alpha.id, ['issues'])
    setEnabledModules(database.db, beta.id, ['operations'])
    expect(listEnabledModules(database.db, alpha.id)).toEqual(['issues'])
    deleteWorkspace(database.db, 'alpha')
    expect(listEnabledModules(database.db, alpha.id)).toEqual([])
    expect(listEnabledModules(database.db, beta.id)).toEqual(['operations'])
  })
})

describe('module enablement routes', () => {
  it('a new workspace reports no modules', async () => {
    await workspace('alpha')
    const res = await app().request('/workspaces/alpha/modules')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual<WorkspaceModulesResponse>({ modules: [] })
  })

  it('persists enabling and disabling', async () => {
    await workspace('alpha')
    expect(await (await put('alpha', { modules: ['issues', 'agent-hub'] })).json()).toEqual({ modules: ['issues', 'agent-hub'] })
    expect(await (await app().request('/workspaces/alpha/modules')).json()).toEqual({ modules: ['issues', 'agent-hub'] })
    await put('alpha', { modules: ['agent-hub'] })
    expect(await (await app().request('/workspaces/alpha/modules')).json()).toEqual({ modules: ['agent-hub'] })
  })

  it('rejects an unknown module id and leaves the set unchanged', async () => {
    await workspace('alpha')
    await put('alpha', { modules: ['issues'] })
    const res = await put('alpha', { modules: ['issues', 'bots'] })
    expect(res.status).toBe(422)
    expect((await res.json() as ApiErrorBody).error.code).toBe('module_not_found')
    expect(await (await app().request('/workspaces/alpha/modules')).json()).toEqual({ modules: ['issues'] })
  })

  it('rejects malformed bodies and unknown workspaces', async () => {
    await workspace('alpha')
    for (const body of ['{', { modules: 'issues' }, { modules: [1] }, {}]) {
      const res = await put('alpha', body)
      expect([res.status, (await res.json() as ApiErrorBody).error.code]).toEqual([400, 'invalid_request'])
    }
    expect((await put('ghost', { modules: [] })).status).toBe(404)
    expect((await app().request('/workspaces/ghost/modules')).status).toBe(404)
  })

  it('is admin only', async () => {
    await workspace('alpha')
    expect((await app(['developer']).request('/workspaces/alpha/modules')).status).toBe(403)
    expect((await put('alpha', { modules: ['issues'] }, ['developer'])).status).toBe(403)
  })
})
