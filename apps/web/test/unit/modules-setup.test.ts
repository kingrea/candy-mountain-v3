import type { ModuleInfo, PluginInstance, PluginTypeInfo } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { modulePluginNeeds, pluginHealth, toggledModules } from '../../app/utils/modules-setup'

function type(id: PluginTypeInfo['id'], name: string, secret = false): PluginTypeInfo {
  return { id, name, description: '', reach: [], scopes: ['project', 'global'], singleInstance: true, configFields: [], secretFields: secret ? [{ name: 'token', label: 'Token', required: true }] : [] }
}

const TYPES = [type('repository', 'Repository', true), type('claude-code', 'Claude Code'), type('codex', 'Codex')]

function instance(overrides: Partial<PluginInstance>): PluginInstance {
  return { id: 'i', type: 'repository', scope: 'project', projectId: 'p1', projectSlug: 'acme', config: {}, secrets: { token: 'set' }, health: { healthy: true, checkedAt: '' }, createdAt: '', updatedAt: '', ...overrides }
}

const capability = (label: string, requiresPlugins: string[], requiresAnyPlugins: PluginTypeInfo['id'][][] = []) =>
  ({ capabilityId: 'bots', defaultRung: 'manage', label, description: '', requiresPlugins, requiresAnyPlugins, requiresProjectFacts: [] }) as ModuleInfo['capabilities'][number]

describe('modulePluginNeeds', () => {
  it('unions required and any-of plugins across capabilities, once each', () => {
    const mod: ModuleInfo = {
      id: 'agent-hub',
      label: 'Agent Hub',
      description: '',
      icon: '',
      capabilities: [capability('Bots', ['repository'], [['claude-code', 'codex']]), capability('Chat', ['repository', 'codex'])],
    }
    expect(modulePluginNeeds(mod, TYPES)).toEqual([
      { typeId: 'repository', name: 'Repository', neededBy: ['Bots', 'Chat'], alternatives: [] },
      { typeId: 'claude-code', name: 'Claude Code', neededBy: ['Bots'], alternatives: ['Codex'] },
      { typeId: 'codex', name: 'Codex', neededBy: ['Bots', 'Chat'], alternatives: [] },
    ])
  })
})

describe('pluginHealth', () => {
  it('prefers the project instance over the platform one', () => {
    const health = pluginHealth('repository', TYPES, [
      instance({ scope: 'global', projectId: null, health: { healthy: false, reason: 'Bad credentials', checkedAt: '' } }),
      instance({}),
    ])
    expect(health).toMatchObject({ state: 'healthy', scope: 'project' })
  })

  it('falls back to the platform instance and reports each state', () => {
    expect(pluginHealth('repository', TYPES, [])).toMatchObject({ state: 'missing', scope: null })
    expect(pluginHealth('repository', TYPES, [instance({ scope: 'global', secrets: { token: 'unset' } })])).toMatchObject({ state: 'secrets-missing', scope: 'global' })
    expect(pluginHealth('repository', TYPES, [instance({ health: null })]).state).toBe('untested')
    expect(pluginHealth('repository', TYPES, [instance({ health: { healthy: false, reason: 'Bad credentials', checkedAt: '' } })]))
      .toMatchObject({ state: 'unhealthy', detail: 'This project\'s instance is unhealthy: Bad credentials' })
  })
})

describe('toggledModules', () => {
  const order = ['issues', 'agent-hub', 'operations']

  it('keeps module order when enabling and disabling', () => {
    expect(toggledModules(order, ['operations'], 'issues', true)).toEqual(['issues', 'operations'])
    expect(toggledModules(order, ['issues', 'operations'], 'issues', false)).toEqual(['operations'])
  })

  it('takes any module ids the daemon lists and drops ones it no longer does', () => {
    expect(toggledModules(['crm', 'operations'], ['retired', 'operations'], 'crm', true)).toEqual(['crm', 'operations'])
  })
})
