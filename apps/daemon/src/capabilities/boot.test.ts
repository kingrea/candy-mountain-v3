import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { startPlatform } from '../platform'
import { createTempDataDir, type TempDataDir } from '../testing'
import { cloneManifest, fixtureCapability } from './fixtures'
import { CapabilityManifestError } from './manifest'

describe('daemon boot with capability manifests', () => {
  let temp: TempDataDir

  afterEach(() => temp?.cleanup())

  it('refuses to start on a bad manifest and touches nothing on disk', () => {
    temp = createTempDataDir()
    const bad = cloneManifest(fixtureCapability('uptime'))
    bad.ladder[2]!.views = []

    expect(() => startPlatform(temp.root, { capabilities: [bad] })).toThrow(CapabilityManifestError)
    expect(() => startPlatform(temp.root, { capabilities: [bad] })).toThrow("Capability 'uptime': rung 'full' hides view(s)")
    expect(existsSync(temp.root)).toBe(false)
  })

  it('refuses to start when manifests collide', () => {
    temp = createTempDataDir()
    expect(() => startPlatform(temp.root, { capabilities: [fixtureCapability('team'), fixtureCapability('team')] })).toThrow(
      "Duplicate capability id(s) across capabilities: 'team' (team).",
    )
  })

  it('starts with valid manifests and hands the registry to routes', async () => {
    temp = createTempDataDir()
    const platform = startPlatform(temp.root, { capabilities: [fixtureCapability('overview')], modules: [] })
    try {
      expect(platform.capabilities.list().map(c => c.id)).toEqual(['overview'])

      const app = createApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules })
      app.get('/__capabilities', c => c.json(c.var.capabilities.list().map(cap => cap.id)))
      const res = await app.request('/__capabilities')
      expect(await res.json()).toEqual(['overview'])
    } finally {
      platform.close()
    }
  })
})
