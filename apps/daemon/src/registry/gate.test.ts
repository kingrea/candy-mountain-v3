import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, ModuleDefinition, Project } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { createCapabilityRegistry, defineCapability } from '../capabilities'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { setGrant } from '../grants/grants'
import { addRole } from '../grants/test-access'
import { createModuleRegistry } from '../modules'
import { createPluginTypeRegistry } from '../plugins'
import { lockedSecretsStore } from '../secrets'
import { createProject } from '../projects/projects'
import { setEnabledModules } from '../project-modules/enablement'
import { openTestDatabase } from '../testing'
import { checkChat, checkTool, checkView, gateChat, gateTool, gateView, requireCapability, type CapabilityAccess } from './gate'
import type { RegistryDeps } from './load'

/** 'full' adds a tool and chat that 'read' lacks, and widens the search scope. */
const issues = defineCapability({
  id: 'issues',
  label: 'Issues',
  description: 'Issues.',
  views: [{ id: 'issues-home', label: 'Home', icon: 'i-lucide-box', path: 'issues' }, { id: 'issues-admin', label: 'Admin', icon: 'i-lucide-settings', path: 'issues/admin' }],
  agents: [{ id: 'issues-agent', label: 'Agent', description: 'Agent.' }],
  jobs: [],
  requiresPlugins: [],
  tools: [{ id: 'issues.read', kind: 'tool' }, { id: 'issues.write', kind: 'tool' }, { id: 'issues.search', kind: 'operation', scope: { dimension: 'project', levels: ['own', 'all'] } }],
  ladder: [
    { name: 'none', label: 'None', description: 'Nothing.', views: [], chat: false, tools: {} },
    { name: 'read', label: 'Read', description: 'Look.', views: ['issues-home'], chat: false, tools: { 'issues.read': {}, 'issues.search': { scope: 'own' } } },
    { name: 'full', label: 'Full', description: 'All.', views: ['issues-home', 'issues-admin'], chat: true, tools: { 'issues.read': {}, 'issues.write': {}, 'issues.search': { scope: 'all' } } },
  ],
})

const MODULES: readonly ModuleDefinition[] = [
  { id: 'issues', label: 'Issues', description: 'Issues.', icon: 'i-lucide-list-todo', capabilities: [{ capabilityId: 'issues', defaultRung: 'read' }] },
  { id: 'agent-hub', label: 'Agent Hub', description: 'Agents.', icon: 'i-lucide-bot', capabilities: [] },
  { id: 'operations', label: 'Operations', description: 'Ops.', icon: 'i-lucide-activity', capabilities: [] },
]

function access(overrides: Partial<CapabilityAccess> = {}): CapabilityAccess {
  return { capabilityId: 'issues', projectSlug: 'alpha', admin: false, capability: issues, enabled: true, rung: issues.ladder[1], reasons: [], ...overrides }
}

describe('gate checks', () => {
  it('refuses a tool below its rung as a value', () => {
    expect(checkTool(access(), 'issues.write')).toEqual({ allowed: false, code: 'not_granted', status: 403, reason: 'Rung \'read\' of \'issues\' does not grant tool \'issues.write\'.' })
    expect(checkTool(access({ rung: issues.ladder[2] }), 'issues.write')).toEqual({ allowed: true, rung: 'full' })
  })

  it('reports the granted scope level of a scoped tool', () => {
    expect(checkTool(access(), 'issues.search')).toEqual({ allowed: true, rung: 'read', scope: 'own' })
    expect(checkTool(access({ rung: issues.ladder[2] }), 'issues.search')).toEqual({ allowed: true, rung: 'full', scope: 'all' })
    expect(checkTool(access(), 'issues.read')).toEqual({ allowed: true, rung: 'read' })
  })

  it('gates views and chat on the rung', () => {
    expect(checkView(access(), 'issues-home')).toEqual({ allowed: true, rung: 'read' })
    expect(checkView(access(), 'issues-admin')).toMatchObject({ allowed: false, code: 'not_granted', status: 403 })
    expect(checkChat(access())).toMatchObject({ allowed: false, code: 'not_granted', status: 403, reason: 'Rung \'read\' of \'issues\' does not allow chat.' })
    expect(checkChat(access({ rung: issues.ladder[2] }))).toEqual({ allowed: true, rung: 'full' })
  })

  it('refuses an ungranted, unknown or unenabled capability', () => {
    expect(checkView(access({ rung: issues.ladder[0] }), 'issues-home')).toMatchObject({ allowed: false, code: 'not_granted', status: 403 })
    expect(checkView(access({ capability: undefined, rung: undefined }), 'issues-home')).toEqual({ allowed: false, code: 'capability_unknown', status: 404, reason: 'Capability \'issues\' is not registered.' })
    expect(checkView(access({ enabled: false }), 'issues-home')).toEqual({ allowed: false, code: 'not_enabled', status: 404, reason: 'Capability \'issues\' is not enabled for project \'alpha\'.' })
  })

  it('refuses an unready capability after the rung check, with reasons for the admin only', () => {
    const reasons = [{ kind: 'plugin' as const, plugin: 'repository', message: 'The Repository plugin is unhealthy: Bad credentials' }]
    expect(checkTool(access({ reasons }), 'issues.read')).toEqual({ allowed: false, code: 'not_ready', status: 409, reason: 'Capability \'issues\' is not ready for project \'alpha\'.' })
    expect(checkTool(access({ reasons, admin: true }), 'issues.read')).toMatchObject({ reason: 'Capability \'issues\' is not ready for project \'alpha\'. The Repository plugin is unhealthy: Bad credentials' })
    expect(checkTool(access({ reasons }), 'issues.write')).toMatchObject({ code: 'not_granted' })
  })
})

describe('gate helpers over the database', () => {
  let database: PlatformDatabase
  let root: string
  let deps: RegistryDeps
  let project: Project
  const developer: Actor = { id: 'u2', username: 'dev', displayName: 'Dev', roles: ['developer'] }
  const admin: Actor = { id: 'u1', username: 'admin', displayName: 'Admin', roles: ['admin'] }

  beforeEach(async () => {
    database = openTestDatabase()
    root = mkdtempSync(join(tmpdir(), 'candy-mountain-gate-'))
    const capabilities = createCapabilityRegistry([issues])
    deps = { db: database.db, capabilities, modules: createModuleRegistry(MODULES, capabilities), pluginTypes: createPluginTypeRegistry([]), secrets: lockedSecretsStore().writeOnly }
    addRole(database.db, 'developer')
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'issues' }, rungs: { issues: 'read' } })
    project = await createProject(database.db, { name: 'Alpha', slug: 'alpha', source: { kind: 'local-path', path: root } })
    setEnabledModules(database.db, project.id, ['issues'])
  })
  afterEach(() => {
    database.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves the actor rung, enablement and readiness', () => {
    expect(gateTool(deps, developer, project, 'issues', 'issues.write')).toMatchObject({ allowed: false, code: 'not_granted' })
    expect(gateTool(deps, developer, project, 'issues', 'issues.search')).toEqual({ allowed: true, rung: 'read', scope: 'own' })
    expect(gateTool(deps, admin, project, 'issues', 'issues.write')).toEqual({ allowed: true, rung: 'full' })
    expect(gateView(deps, developer, project, 'issues', 'issues-admin')).toMatchObject({ code: 'not_granted' })
    expect(gateChat(deps, developer, project, 'issues')).toMatchObject({ code: 'not_granted' })
    expect(gateChat(deps, admin, project, 'issues')).toEqual({ allowed: true, rung: 'full' })
    expect(gateView(deps, admin, project, 'uptime', 'uptime-home')).toMatchObject({ code: 'capability_unknown' })
    setEnabledModules(database.db, project.id, [])
    expect(gateView(deps, admin, project, 'issues', 'issues-home')).toMatchObject({ code: 'not_enabled', status: 404 })
  })

  it('refuses from middleware with the error body and status', async () => {
    const as = (actor: Actor): AuthStrategy => ({ name: 'development', resolve: () => actor })
    const build = (actor: Actor) => {
      const app = createApp({ db: database.db, paths: dataPaths(root), auth: as(actor), capabilities: deps.capabilities, modules: deps.modules, pluginTypes: deps.pluginTypes })
      app.get('/projects/:slug/write', requireCapability({ capability: 'issues', tool: 'issues.write' }), c => c.json({ ok: true }))
      app.get('/projects/:slug/home', requireCapability({ capability: 'issues', view: 'issues-home' }), c => c.json({ ok: true }))
      return app
    }
    const refused = await build(developer).request('/projects/alpha/write')
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: { code: 'not_granted', message: 'Rung \'read\' of \'issues\' does not grant tool \'issues.write\'.' } })
    expect((await build(developer).request('/projects/alpha/home')).status).toBe(200)
    expect((await build(admin).request('/projects/alpha/write')).status).toBe(200)
    const missing = await build(admin).request('/projects/ghost/write')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: { code: 'not_found', message: 'No project with slug "ghost"' } })
  })
})
