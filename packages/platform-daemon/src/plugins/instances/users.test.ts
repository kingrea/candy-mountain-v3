import { describe, expect, it } from 'vitest'
import { cloneManifest, fixtureCapability, fixtureDefinition } from '../../capabilities/fixtures'
import { createCapabilityRegistry } from '../../capabilities/registry'
import { fixturePluginType } from '../fixtures'
import { pluginTypeUsers } from './users'

describe('pluginTypeUsers', () => {
  const registry = () => {
    const bots = cloneManifest(fixtureCapability('bots', ['repository']))
    bots.requiresAnyPlugins = [['claude-code', 'codex']]
    return createCapabilityRegistry([
      fixtureDefinition('repository', { manifest: null, pluginTypes: [fixturePluginType('repository')] }),
      fixtureDefinition('codex', { manifest: null, pluginTypes: [fixturePluginType('codex')] }),
      fixtureCapability('chat-codex', ['codex']),
      fixtureCapability('deployments', ['repository']),
      bots,
      fixtureCapability('issues'),
    ], { pluginTypeIds: ['claude-code'] })
  }

  it('lists the capabilities that require the type, any-of groups included, in registration order', () => {
    expect(pluginTypeUsers('codex', registry())).toEqual([
      { id: 'chat-codex', label: 'Fixture chat-codex' },
      { id: 'bots', label: 'Fixture bots' },
    ])
  })

  it('leaves out the service-only owner', () => {
    expect(pluginTypeUsers('repository', registry()).map(user => user.id)).toEqual(['deployments', 'bots'])
  })

  it('is empty for a type nothing brings or requires', () => {
    expect(pluginTypeUsers('slack', registry())).toEqual([])
  })
})
