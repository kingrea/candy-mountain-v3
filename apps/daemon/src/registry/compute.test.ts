import { CANDY_MOUNTAIN_PRODUCT, type AnyCapabilityManifest, type ModuleDefinition, type ScopeLabel } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { fixtureCapability } from '../capabilities/fixtures'
import { computeRegistry, type RegistryInput } from './compute'
import { assessPluginInstance, type PluginReadiness } from './readiness'

const issues = fixtureCapability('issues')
const uptime = fixtureCapability('uptime', ['repository'])
const team: AnyCapabilityManifest = { ...fixtureCapability('team'), requiresProjectFacts: ['hasBeads'] }
const platformAgent = fixtureCapability('platform-agent')
const CAPABILITIES = [issues, uptime, team, platformAgent]

/** 'platform-agent' belongs to no module, so it is standalone. */
const MODULES: readonly ModuleDefinition[] = [
  { id: 'issues', label: 'Issues', description: 'Issues.', icon: 'i-lucide-list-todo', capabilities: [{ capabilityId: 'issues', defaultRung: 'read' }] },
  { id: 'agent-hub', label: 'Agent Hub', description: 'Agents.', icon: 'i-lucide-bot', capabilities: [] },
  { id: 'operations', label: 'Operations', description: 'Ops.', icon: 'i-lucide-activity', capabilities: [{ capabilityId: 'uptime', defaultRung: 'read' }, { capabilityId: 'team', defaultRung: 'read' }] },
]

const healthy: PluginReadiness = { name: 'Repository', state: 'ready' }

function input(overrides: Partial<RegistryInput> = {}): RegistryInput {
  return {
    project: { id: 'p1', slug: 'alpha', name: 'Alpha' },
    scopeUrlPrefix: 'p',
    scopeLabel: CANDY_MOUNTAIN_PRODUCT.scope.label,
    capabilities: CAPABILITIES,
    modules: MODULES,
    enabledModules: ['issues', 'operations'],
    rungs: { issues: 'read', uptime: 'read', team: 'read', 'platform-agent': 'read' },
    admin: false,
    plugins: { repository: healthy },
    facts: { hasBeads: true, isGitRepo: true, hasRemote: true, hasBots: true },
    ...overrides,
  }
}

const admin = (overrides: Partial<RegistryInput> = {}) => input({ admin: true, rungs: { issues: 'full', uptime: 'full', team: 'full', 'platform-agent': 'full' }, ...overrides })

describe('computeRegistry', () => {
  it('lists the Issues module group for a project with Issues enabled, with absolute view paths', () => {
    const registry = computeRegistry(input({ enabledModules: ['issues'] }))
    expect(registry.modules).toEqual(['issues'])
    expect(registry.groups.map(g => g.id)).toEqual(['issues', 'platform-agent', 'system'])
    expect(registry.groups[0]).toEqual({ id: 'issues', label: 'Issues', icon: 'i-lucide-list-todo', kind: 'module', degraded: false, entries: [{ id: 'issues-home', label: 'Home', icon: 'i-lucide-box', to: '/p/alpha/issues' }] })
    expect(registry.views).toEqual([
      { id: 'issues-home', capabilityId: 'issues', label: 'Home', icon: 'i-lucide-box', path: 'issues', to: '/p/alpha/issues', ready: true },
      { id: 'platform-agent-home', capabilityId: 'platform-agent', label: 'Home', icon: 'i-lucide-box', path: 'platform-agent', to: '/p/alpha/platform-agent', ready: true },
    ])
    expect(registry.capabilities.map(c => c.id)).toEqual(['issues', 'platform-agent'])
    expect(registry.capabilities[0]).toEqual({ id: 'issues', label: 'Fixture issues', rung: 'read', chat: false, ready: true, reasons: [], modules: ['issues'], views: ['issues-home'], tools: ['issues.read', 'issues.search'] })
  })

  it('maps the empty view path to the project home', () => {
    const home: AnyCapabilityManifest = { ...issues, views: [{ id: 'issues-home', label: 'Home', icon: 'i-lucide-box', path: '' }, issues.views[1]!] }
    const registry = computeRegistry(input({ capabilities: [home], enabledModules: ['issues'] }))
    expect(registry.views[0]!.to).toBe('/p/alpha')
  })

  it('builds view links under the given scope prefix', () => {
    const registry = computeRegistry(input({ scopeUrlPrefix: 'w', enabledModules: ['issues'] }))
    expect(registry.groups[0]!.entries.map(entry => entry.to)).toEqual(['/w/alpha/issues'])
    expect(registry.views.map(view => view.to)).toEqual(['/w/alpha/issues', '/w/alpha/platform-agent'])
  })

  it('names the workspace with the given scope label in readiness messages and the system group', () => {
    const scopeLabel: ScopeLabel = { singular: 'app', plural: 'apps', singularTitle: 'App', pluralTitle: 'Apps' }
    const registry = computeRegistry(admin({ scopeLabel, plugins: {}, facts: { hasBeads: false, isGitRepo: true, hasRemote: true, hasBots: true } }))
    expect(registry.capabilities.find(c => c.id === 'uptime')!.reasons.map(r => r.message)).toEqual(['No repository plugin is configured for this app or the platform.'])
    expect(registry.capabilities.find(c => c.id === 'team')!.reasons.map(r => r.message)).toEqual(['The app has no .beads directory.'])
    expect(registry.groups.at(-1)!.entries.map(e => e.label)).toEqual(['Apps', 'Activity', 'Settings'])
  })

  it('marks a capability with an unhealthy required plugin not ready and degrades its module naming the plugin', () => {
    const registry = computeRegistry(admin({ plugins: { repository: { name: 'Repository', state: 'unhealthy', reason: 'Bad credentials' } } }))
    const uptimeCap = registry.capabilities.find(c => c.id === 'uptime')!
    expect(uptimeCap.ready).toBe(false)
    expect(uptimeCap.reasons).toEqual([{ kind: 'plugin', plugin: 'repository', message: 'The Repository plugin is unhealthy: Bad credentials' }])
    expect(registry.degraded).toEqual([{ id: 'operations', label: 'Operations', reasons: [{ kind: 'plugin', plugin: 'repository', capabilityId: 'uptime', message: 'The Repository plugin is unhealthy: Bad credentials' }] }])
    const operations = registry.groups.find(g => g.id === 'operations')!
    expect(operations.degraded).toBe(true)
    expect(operations.entries.map(e => e.id)).toEqual(['uptime-home', 'uptime-admin', 'team-home', 'team-admin'])
    expect(registry.agents.map(a => a.id)).toEqual(['issues-agent', 'team-agent', 'platform-agent-agent'])
    expect(registry.views.find(v => v.id === 'uptime-home')!.ready).toBe(false)
  })

  it('treats a plugin type with no instance as missing', () => {
    const registry = computeRegistry(admin({ plugins: {} }))
    expect(registry.capabilities.find(c => c.id === 'uptime')!.reasons).toEqual([{ kind: 'plugin', plugin: 'repository', message: 'No repository plugin is configured for this project or the platform.' }])
  })

  it('hides unready capabilities and all reasons from non-admins', () => {
    const registry = computeRegistry(input({ plugins: { repository: { name: 'Repository', state: 'untested' } } }))
    const operations = registry.groups.find(g => g.id === 'operations')!
    expect(operations.degraded).toBe(false)
    expect(operations.entries.map(e => e.id)).toEqual(['team-home'])
    expect(registry.degraded).toEqual([])
    expect(registry.capabilities.find(c => c.id === 'uptime')).toMatchObject({ ready: false, reasons: [] })
    expect(registry.views.find(v => v.id === 'uptime-home')).toMatchObject({ ready: false })
  })

  it('omits an ungranted capability', () => {
    const registry = computeRegistry(input({ rungs: { issues: 'read', uptime: 'none', team: 'read' } }))
    expect(registry.capabilities.map(c => c.id)).toEqual(['issues', 'team'])
    expect(registry.views.some(v => v.capabilityId === 'uptime')).toBe(false)
    expect(registry.groups.find(g => g.id === 'operations')!.entries.map(e => e.id)).toEqual(['team-home'])
    expect(registry.groups.map(g => g.id)).toEqual(['issues', 'operations', 'system'])
  })

  it('treats a stale rung name as none', () => {
    const registry = computeRegistry(input({ rungs: { issues: 'owner', team: 'read' } }))
    expect(registry.capabilities.map(c => c.id)).toEqual(['team'])
  })

  it('shows the admin everything at the top rung, including chat agents of ready capabilities', () => {
    const registry = computeRegistry(admin())
    expect(registry.admin).toBe(true)
    expect(registry.capabilities.map(c => [c.id, c.rung, c.chat])).toEqual([['issues', 'full', true], ['uptime', 'full', true], ['team', 'full', true], ['platform-agent', 'full', true]])
    expect(registry.views.map(v => v.id)).toEqual(['issues-home', 'issues-admin', 'uptime-home', 'uptime-admin', 'team-home', 'team-admin', 'platform-agent-home', 'platform-agent-admin'])
    expect(registry.agents).toEqual([
      { id: 'issues-agent', capabilityId: 'issues', label: 'Agent', description: 'Fixture agent.' },
      { id: 'uptime-agent', capabilityId: 'uptime', label: 'Agent', description: 'Fixture agent.' },
      { id: 'team-agent', capabilityId: 'team', label: 'Agent', description: 'Fixture agent.' },
      { id: 'platform-agent-agent', capabilityId: 'platform-agent', label: 'Agent', description: 'Fixture agent.' },
    ])
    expect(registry.degraded).toEqual([])
    expect(registry.capabilities.find(c => c.id === 'uptime')!.tools).toEqual(['uptime.read', 'uptime.search'])
  })

  it('checks a required project fact', () => {
    const registry = computeRegistry(admin({ facts: { hasBeads: false, isGitRepo: true, hasRemote: true, hasBots: true } }))
    expect(registry.capabilities.find(c => c.id === 'team')).toMatchObject({ ready: false, reasons: [{ kind: 'project-fact', fact: 'hasBeads', message: 'The project has no .beads directory.' }] })
    expect(registry.degraded[0]!.reasons.map(r => r.capabilityId)).toEqual(['team'])
  })

  it('excludes capabilities of modules the project has not enabled', () => {
    const registry = computeRegistry(admin({ enabledModules: [] }))
    expect(registry.capabilities.map(c => c.id)).toEqual(['platform-agent'])
    expect(registry.groups.map(g => g.id)).toEqual(['platform-agent', 'system'])
    expect(registry.degraded).toEqual([])
  })

  it('gives a standalone capability its own group and drops groups with nothing to show', () => {
    const registry = computeRegistry(input({ enabledModules: ['agent-hub'] }))
    expect(registry.groups).toEqual([
      { id: 'platform-agent', label: 'Fixture platform-agent', icon: 'i-lucide-box', kind: 'capability', degraded: false, entries: [{ id: 'platform-agent-home', label: 'Home', icon: 'i-lucide-box', to: '/p/alpha/platform-agent' }] },
      expect.objectContaining({ id: 'system', kind: 'system' }),
    ])
    expect(registry.capabilities[0]!.modules).toEqual([])
  })

  it('ends with the fixed system group', () => {
    const [system] = computeRegistry(input()).groups.slice(-1)
    expect(system).toEqual({ id: 'system', label: 'System', icon: 'i-lucide-settings', kind: 'system', degraded: false, entries: [
      { id: 'projects', label: 'Projects', icon: 'i-lucide-folder-git-2', to: '/projects' },
      { id: 'activity', label: 'Activity', icon: 'i-lucide-history', to: '/activity' },
      { id: 'settings', label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
    ] })
  })
})

describe('assessPluginInstance', () => {
  const type = { name: 'Repository', secretFields: [{ name: 'token', label: 'Token', required: true }, { name: 'extra', label: 'Extra' }] }
  const at = '2026-10-28T00:00:00.000Z'

  it('grades stored state without re-testing', () => {
    expect(assessPluginInstance('repository', type, null)).toEqual({ name: 'Repository', state: 'missing' })
    expect(assessPluginInstance('repository', type, { secrets: { token: 'unset', extra: 'unset' }, health: { healthy: true, checkedAt: at } })).toEqual({ name: 'Repository', state: 'secrets_missing', secrets: ['token'] })
    expect(assessPluginInstance('repository', type, { secrets: { token: 'set' }, health: null })).toEqual({ name: 'Repository', state: 'untested' })
    expect(assessPluginInstance('repository', type, { secrets: { token: 'set' }, health: { healthy: false, reason: 'Nope', checkedAt: at } })).toEqual({ name: 'Repository', state: 'unhealthy', reason: 'Nope' })
    expect(assessPluginInstance('repository', type, { secrets: { token: 'set' }, health: { healthy: true, checkedAt: at } })).toEqual({ name: 'Repository', state: 'ready' })
  })

  it('falls back to the type id when the type is not registered', () => {
    expect(assessPluginInstance('ghost', undefined, null)).toEqual({ name: 'ghost', state: 'missing' })
  })
})
