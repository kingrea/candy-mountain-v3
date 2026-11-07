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
      fixtureDefinition('chat-codex', { pluginTypes: [fixturePluginType('codex')] }),
      fixtureCapability('deployments', ['repository']),
      bots,
      fixtureCapability('issues'),
    ], { pluginTypeIds: ['claude-code'] })
  }

  it('names the owner first, then the capabilities that require the type', () => {
    expect(pluginTypeUsers('codex', registry())).toEqual([
      { id: 'chat-codex', label: 'Fixture chat-codex' },
      { id: 'bots', label: 'Fixture bots' },
    ])
  })

  it('leaves out a service-only owner and lists requirers in registration order', () => {
    expect(pluginTypeUsers('repository', registry()).map(user => user.id)).toEqual(['deployments', 'bots'])
  })

  it('is empty for a type nothing brings or requires', () => {
    expect(pluginTypeUsers('slack', registry())).toEqual([])
  })
})
