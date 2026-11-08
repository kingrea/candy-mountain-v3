import { describe, expect, it } from 'vitest'
import { CapabilityDefinitionError, defineCapabilityDefinition } from './capability'
import { defineCapability } from './manifest'
import { definePluginType } from './plugin-types'

const manifest = defineCapability({
  id: 'deployments',
  label: 'Deployments',
  description: 'Deploys.',
  views: [],
  agents: [],
  jobs: [],
  requiresPlugins: ['heroku'],
  tools: [],
  ladder: [{ name: 'none', label: 'None', description: 'Nothing.', views: [], chat: false, tools: {} }],
})

const heroku = definePluginType({
  id: 'heroku',
  name: 'Heroku',
  description: 'Heroku apps.',
  reach: ['Read releases.'],
  scopes: ['workspace'],
  singleInstance: false,
  configFields: [],
  secretFields: [],
  healthCheck: () => ({ healthy: true }),
})

describe('defineCapabilityDefinition and plugin types', () => {
  it('refuses a definition with a manifest that brings a plugin type, naming it', () => {
    const define = () => defineCapabilityDefinition({ id: 'deployments', manifest, pluginTypes: [heroku] })
    expect(define).toThrow(CapabilityDefinitionError)
    expect(define).toThrow("Capability 'deployments': has a manifest and brings plugin type 'heroku'")
  })

  it('accepts a manifest alone and a plugin type alone', () => {
    expect(() => defineCapabilityDefinition({ id: 'deployments', manifest })).not.toThrow()
    expect(() => defineCapabilityDefinition({ id: 'heroku', pluginTypes: [heroku] })).not.toThrow()
  })
})
