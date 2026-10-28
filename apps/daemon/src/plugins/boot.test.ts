import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityManifestError } from '../capabilities'
import { fixtureCapability } from '../capabilities/fixtures'
import { startPlatform } from '../platform'
import { createTempDataDir, type TempDataDir } from '../testing'
import { PluginTypeError } from './definition'
import { clonePluginType, fixturePluginType } from './fixtures'

describe('daemon boot with plugin types', () => {
  let temp: TempDataDir

  afterEach(() => temp?.cleanup())

  it('refuses to start when a manifest requires an unknown plugin type', () => {
    temp = createTempDataDir()
    const start = () => startPlatform(temp.root, {
      pluginTypes: [fixturePluginType('repository')],
      capabilities: [fixtureCapability('deployments', ['repository', 'netlify'])],
    })
    expect(start).toThrow(CapabilityManifestError)
    expect(start).toThrow("Capability 'deployments' requires unknown plugin type 'netlify'.")
    expect(existsSync(temp.root)).toBe(false)
  })

  it('refuses to start on a bad plugin type', () => {
    temp = createTempDataDir()
    const bad = clonePluginType(fixturePluginType('slack'))
    bad.scopes = []
    expect(() => startPlatform(temp.root, { pluginTypes: [bad] })).toThrow(PluginTypeError)
    expect(existsSync(temp.root)).toBe(false)
  })

  it('starts when every required plugin type is registered', () => {
    temp = createTempDataDir()
    const platform = startPlatform(temp.root, {
      pluginTypes: [fixturePluginType('repository'), fixturePluginType('netlify')],
      capabilities: [fixtureCapability('deployments', ['repository', 'netlify'])],
      modules: [],
    })
    try {
      expect(platform.pluginTypes.ids()).toEqual(['repository', 'netlify'])
      expect(platform.capabilities.has('deployments')).toBe(true)
    }
    finally {
      platform.close()
    }
  })
})
