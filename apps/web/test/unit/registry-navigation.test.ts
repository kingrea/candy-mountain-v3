import { REGISTRY_SYSTEM_GROUP, type RegistryCapability, type RegistryResponse } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { registryNavGroups } from '../../app/utils/navigation'
import { lockoutActions, projectRegistryKey, resolveViewAccess } from '../../app/utils/registry'

const PLUGIN_REASON = { kind: 'plugin', plugin: 'repository', message: 'No Repository plugin is configured for this project or the platform.' } as const

function capability(id: RegistryCapability['id'], ready: boolean, admin = true): RegistryCapability {
  return { id, label: id, rung: 'manage', chat: false, ready, reasons: ready || !admin ? [] : [PLUGIN_REASON], modules: ['agent-hub'], views: [id], tools: [] }
}

function registry(overrides: Partial<RegistryResponse> = {}): RegistryResponse {
  return {
    project: { id: 'p1', slug: 'acme', name: 'Acme' },
    admin: true,
    modules: ['agent-hub'],
    groups: [
      {
        id: 'agent-hub',
        label: 'Agent Hub',
        icon: 'i-lucide-bot',
        kind: 'module',
        degraded: true,
        entries: [
          { id: 'bots', label: 'Bots', icon: 'i-lucide-bot', to: '/p/acme/bots' },
          { id: 'team', label: 'Team', icon: 'i-lucide-users', to: '/p/acme/team' },
        ],
      },
      REGISTRY_SYSTEM_GROUP,
    ],
    views: [
      { id: 'bots', capabilityId: 'bots', label: 'Bots', icon: 'i-lucide-bot', path: 'bots', to: '/p/acme/bots', ready: true },
      { id: 'team', capabilityId: 'team', label: 'Team', icon: 'i-lucide-users', path: 'team', to: '/p/acme/team', ready: false },
    ],
    agents: [],
    capabilities: [capability('bots', true), capability('team', false)],
    degraded: [
      { id: 'agent-hub', label: 'Agent Hub', reasons: [{ ...PLUGIN_REASON, capabilityId: 'team' }, { ...PLUGIN_REASON, capabilityId: 'bots' }] },
    ],
    ...overrides,
  }
}

describe('registryNavGroups', () => {
  it('shows only the system group without a registry, with setup links for the admin', () => {
    const { capabilityGroups, systemGroup } = registryNavGroups(null, 'acme', true)
    expect(capabilityGroups).toEqual([])
    expect(systemGroup.entries.map(entry => entry.to)).toEqual([
      '/p/acme/setup/modules',
      '/p/acme/setup/plugins',
      '/p/acme/setup/notifications',
      '/grants',
      '/projects',
      '/activity',
      '/settings',
    ])
  })

  it('keeps project setup links out of non-project pages and away from other roles', () => {
    expect(registryNavGroups(null, null, true).systemGroup.entries.map(entry => entry.id)).toEqual(['grants', 'projects', 'activity', 'settings'])
    expect(registryNavGroups(null, 'acme', false).systemGroup.entries.map(entry => entry.id)).toEqual(['projects', 'activity', 'settings'])
  })

  it('maps module groups in registry order, marks degraded ones and locks unready views', () => {
    const { capabilityGroups, systemGroup } = registryNavGroups(registry(), 'acme', true)
    expect(capabilityGroups).toHaveLength(1)
    const [group] = capabilityGroups
    expect(group?.warning).toBe(PLUGIN_REASON.message)
    expect(group?.entries.map(entry => [entry.id, entry.locked])).toEqual([['bots', false], ['team', true]])
    expect(systemGroup.id).toBe('system')
  })

  it('matches the project home entry exactly so it is not active on every project page', () => {
    const home = registry({
      groups: [{ id: 'issues', label: 'Issues', icon: 'i-lucide-list-todo', kind: 'module', degraded: false, entries: [
        { id: 'overview', label: 'Overview', icon: 'i-lucide-house', to: '/p/acme' },
        { id: 'issues', label: 'Issues', icon: 'i-lucide-list-todo', to: '/p/acme/issues' },
      ] }, REGISTRY_SYSTEM_GROUP],
      views: [
        { id: 'overview', capabilityId: 'overview', label: 'Overview', icon: 'i-lucide-house', path: '', to: '/p/acme', ready: true },
        { id: 'issues', capabilityId: 'issues', label: 'Issues', icon: 'i-lucide-list-todo', path: 'issues', to: '/p/acme/issues', ready: true },
      ],
      degraded: [],
    })
    expect(registryNavGroups(home, 'acme', true).capabilityGroups[0]?.entries.map(entry => [entry.id, entry.exact])).toEqual([['overview', true], ['issues', false]])
  })

  it('shows only the system group when the project has no modules enabled', () => {
    const empty = registry({ modules: [], groups: [REGISTRY_SYSTEM_GROUP], views: [], capabilities: [], degraded: [] })
    expect(registryNavGroups(empty, 'acme', true).capabilityGroups).toEqual([])
  })
})

describe('resolveViewAccess', () => {
  it('lets a ready view through', () => {
    expect(resolveViewAccess(registry(), 'bots', 'bots').state).toBe('ready')
  })

  it('locks out a view whose capability is not ready, carrying the reasons', () => {
    const access = resolveViewAccess(registry(), 'team', 'team')
    expect(access.state).toBe('not-ready')
    expect(access.state === 'not-ready' && access.capability.reasons).toEqual([PLUGIN_REASON])
  })

  it('reports a capability absent for the admin as not enabled and for other roles as not granted', () => {
    expect(resolveViewAccess(registry(), 'issues', 'issues').state).toBe('not-enabled')
    expect(resolveViewAccess(registry({ admin: false }), 'issues', 'issues').state).toBe('not-granted')
  })

  it('refuses a view the rung does not show', () => {
    expect(resolveViewAccess(registry(), 'bots', 'bots-admin').state).toBe('not-granted')
  })
})

describe('projectRegistryKey', () => {
  it('keys the registry per project', () => {
    expect(projectRegistryKey('acme')).not.toBe(projectRegistryKey('other'))
    expect(projectRegistryKey(null)).toBe('project-registry:')
  })
})

describe('lockoutActions', () => {
  const to = (reasons: Parameters<typeof lockoutActions>[0]) => lockoutActions(reasons, 'acme').map(action => action.to)

  it('links plugin reasons, one-of plugin reasons included, to the Plugins page once', () => {
    expect(to([PLUGIN_REASON, { kind: 'plugin-any', plugins: ['claude-code', 'codex'], message: 'Needs one of Claude Code, Codex.' }])).toEqual(['/p/acme/setup/plugins'])
  })

  it('sends a missing bot to the Bots page and a path fact to Projects', () => {
    expect(to([
      { kind: 'project-fact', fact: 'hasBots', message: 'The project has no bots.' },
      { kind: 'project-fact', fact: 'hasBeads', message: 'The project has no .beads directory.' },
    ])).toEqual(['/p/acme/bots', '/projects'])
  })

  it('falls back to the Plugins page when the reasons are hidden', () => {
    expect(to([])).toEqual(['/p/acme/setup/plugins'])
  })
})
