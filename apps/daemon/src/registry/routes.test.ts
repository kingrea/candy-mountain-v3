import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { projectRegistryPath, type Actor, type AnyCapabilityManifest, type ModuleDefinition, type PluginHealth, type RegistryResponse } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { CANDY_MOUNTAIN } from '../candy-mountain'
import { createCapabilityRegistry } from '../capabilities'
import { fixtureCapability } from '../capabilities/fixtures'
import type { DataPaths } from '../data-dir'
import { setGrant } from '../grants/grants'
import { addRole } from '../grants/test-access'
import { createModuleRegistry } from '../modules'
import { createPluginInstance, testPluginInstance } from '../plugins/instances/instances'
import { instanceHarness, multiPluginType, type InstanceHarness } from '../plugins/instances/test-support'
import { reverifyProject } from '../projects/projects'
import type { Product } from '../product'
import { setEnabledModules } from '../project-modules/enablement'

const chatCodex = fixtureCapability('chat-codex', ['codex'])
const issues: AnyCapabilityManifest = { ...fixtureCapability('issues'), requiresProjectFacts: ['hasBeads'] }
const MODULES: readonly ModuleDefinition[] = [
  { id: 'issues', label: 'Issues', description: 'Issues.', icon: 'i-lucide-list-todo', capabilities: [{ capabilityId: 'issues', defaultRung: 'read' }] },
  { id: 'agent-hub', label: 'Agent Hub', description: 'Agents.', icon: 'i-lucide-bot', capabilities: [{ capabilityId: 'chat-codex', defaultRung: 'full' }] },
  { id: 'operations', label: 'Operations', description: 'Ops.', icon: 'i-lucide-activity', capabilities: [] },
]

let harness: InstanceHarness
let health: PluginHealth = { healthy: true }
beforeEach(() => {
  health = { healthy: true }
  harness = instanceHarness([multiPluginType(() => health)])
  addRole(harness.database.db, 'developer')
})
afterEach(() => harness.close())

function app(roles = ['admin'], product: Product = CANDY_MOUNTAIN) {
  const capabilities = createCapabilityRegistry([chatCodex, issues])
  const modules = createModuleRegistry(MODULES, capabilities)
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createApp({ db: harness.database.db, paths: { root: harness.secretsDir } as DataPaths, auth, product, capabilities, modules, pluginTypes: harness.deps.pluginTypes, secrets: harness.store.writeOnly, secretsReader: harness.store })
}

async function registry(slug: string, roles?: string[]): Promise<RegistryResponse> {
  const res = await app(roles).request(projectRegistryPath(slug))
  expect(res.status).toBe(200)
  return res.json() as Promise<RegistryResponse>
}

describe('GET /projects/:slug/registry', () => {
  it('answers per project with enabled modules, readiness and degraded reasons', async () => {
    const alpha = await harness.createProject('alpha')
    setEnabledModules(harness.database.db, alpha.id, ['agent-hub'])

    const before = await registry('alpha')
    expect(before.project).toEqual({ id: alpha.id, slug: 'alpha', name: 'alpha' })
    expect(before.modules).toEqual(['agent-hub'])
    expect(before.capabilities).toEqual([expect.objectContaining({ id: 'chat-codex', rung: 'full', chat: true, ready: false, modules: ['agent-hub'] })])
    expect(before.capabilities[0]!.reasons).toEqual([{ kind: 'plugin', plugin: 'codex', message: 'No Multi plugin is configured for this project or the platform.' }])
    expect(before.agents).toEqual([])
    expect(before.groups.map(g => [g.id, g.degraded])).toEqual([['agent-hub', true], ['system', false]])
    expect(before.groups[0]!.entries.map(e => e.to)).toEqual(['/p/alpha/chat-codex', '/p/alpha/chat-codex/admin'])
    expect(before.degraded).toEqual([{ id: 'agent-hub', label: 'Agent Hub', reasons: [{ kind: 'plugin', plugin: 'codex', capabilityId: 'chat-codex', message: 'No Multi plugin is configured for this project or the platform.' }] }])
  })

  it('links views under the product\'s scope prefix', async () => {
    const alpha = await harness.createProject('alpha')
    setEnabledModules(harness.database.db, alpha.id, ['agent-hub'])
    const config = CANDY_MOUNTAIN.config
    const res = await app(['admin'], { ...CANDY_MOUNTAIN, config: { ...config, scope: { ...config.scope, urlPrefix: 'w' } } }).request(projectRegistryPath('alpha'))
    const body = await res.json() as RegistryResponse
    expect(body.groups[0]!.entries.map(e => e.to)).toEqual(['/w/alpha/chat-codex', '/w/alpha/chat-codex/admin'])
    expect(body.views.map(v => v.to)).toEqual(['/w/alpha/chat-codex', '/w/alpha/chat-codex/admin'])
  })

  it('is satisfied by a healthy global instance, and only after it is tested', async () => {
    const alpha = await harness.createProject('alpha')
    setEnabledModules(harness.database.db, alpha.id, ['agent-hub'])
    const instance = createPluginInstance(harness.deps, { type: 'codex', scope: 'global', projectId: null })

    const untested = await registry('alpha')
    expect(untested.capabilities[0]!.reasons).toEqual([{ kind: 'plugin', plugin: 'codex', message: 'The Multi plugin has not been tested since it was last changed; run its connection test.' }])

    await testPluginInstance(harness.deps, instance.id)
    const ready = await registry('alpha')
    expect(ready.capabilities[0]).toMatchObject({ ready: true, reasons: [] })
    expect(ready.agents).toEqual([{ id: 'chat-codex-agent', capabilityId: 'chat-codex', label: 'Agent', description: 'Fixture agent.' }])
    expect(ready.groups[0]!.degraded).toBe(false)
    expect(ready.degraded).toEqual([])
  })

  it('names the plugin when its instance is unhealthy', async () => {
    const alpha = await harness.createProject('alpha')
    setEnabledModules(harness.database.db, alpha.id, ['agent-hub'])
    health = { healthy: false, reason: 'Login expired' }
    const instance = createPluginInstance(harness.deps, { type: 'codex', scope: 'project', projectId: alpha.id })
    await testPluginInstance(harness.deps, instance.id)

    const result = await registry('alpha')
    expect(result.capabilities[0]!.reasons).toEqual([{ kind: 'plugin', plugin: 'codex', message: 'The Multi plugin is unhealthy: Login expired' }])
    expect(result.degraded[0]!.reasons[0]).toMatchObject({ plugin: 'codex', capabilityId: 'chat-codex' })
    expect(result.agents).toEqual([])
  })

  it('checks a required project fact from the stored verification', async () => {
    const alpha = await harness.createProject('alpha')
    setEnabledModules(harness.database.db, alpha.id, ['issues'])
    expect((await registry('alpha')).capabilities[0]).toMatchObject({ id: 'issues', ready: false, reasons: [{ kind: 'project-fact', fact: 'hasBeads' }] })

    mkdirSync(join(alpha.source.path, '.beads'))
    await reverifyProject(harness.database.db, 'alpha')
    expect((await registry('alpha')).capabilities[0]).toMatchObject({ id: 'issues', ready: true, reasons: [] })
  })

  it('shows a non-admin only what is granted and ready, with no reasons', async () => {
    const alpha = await harness.createProject('alpha')
    setEnabledModules(harness.database.db, alpha.id, ['agent-hub', 'issues'])
    const capabilities = createCapabilityRegistry([chatCodex, issues])
    setGrant({ db: harness.database.db, capabilities, modules: createModuleRegistry(MODULES, capabilities) }, { role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs: {} })

    const result = await registry('alpha', ['developer'])
    expect(result.admin).toBe(false)
    expect(result.capabilities).toEqual([expect.objectContaining({ id: 'chat-codex', rung: 'full', ready: false, reasons: [] })])
    expect(result.groups.map(g => g.id)).toEqual(['system'])
    expect(result.agents).toEqual([])
    expect(result.degraded).toEqual([])
  })

  it('is empty apart from the system group for a project with no modules enabled', async () => {
    await harness.createProject('alpha')
    const result = await registry('alpha')
    expect(result.modules).toEqual([])
    expect(result.capabilities).toEqual([])
    expect(result.groups.map(g => g.id)).toEqual(['system'])
  })

  it('is 404 for an unknown project', async () => {
    const res = await app().request(projectRegistryPath('ghost'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'No project with slug "ghost"' } })
  })
})
