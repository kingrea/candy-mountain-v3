import { existsSync } from 'node:fs'
import { WORKSPACES_PATH } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import type { Platform } from '../platform'
import { createTempDataDir, createTestApp, platformApp, startTestPlatform, type TempDataDir } from '../testing'
import { createWorkspace, findWorkspaceBySlug } from '../workspaces/workspaces'
import { CapabilityDefinitionError } from './definition'
import { cloneManifest, fixtureCapability, fixtureDefinition } from './fixtures'
import { CapabilityManifestError } from './manifest'

describe('daemon boot with capability manifests', () => {
  let temp: TempDataDir

  afterEach(() => temp?.cleanup())

  it('refuses to start on a bad manifest and touches nothing on disk', () => {
    temp = createTempDataDir()
    const bad = cloneManifest(fixtureCapability('uptime'))
    bad.ladder[2]!.views = []

    expect(() => startTestPlatform(temp.root, { capabilities: [bad] })).toThrow(CapabilityManifestError)
    expect(() => startTestPlatform(temp.root, { capabilities: [bad] })).toThrow("Capability 'uptime': rung 'full' hides view(s)")
    expect(existsSync(temp.root)).toBe(false)
  })

  it('refuses to start when manifests collide', () => {
    temp = createTempDataDir()
    expect(() => startTestPlatform(temp.root, { capabilities: [fixtureCapability('team'), fixtureCapability('team')] })).toThrow(
      "Duplicate capability id(s) across capabilities: 'team' (team).",
    )
  })

  it('starts with valid manifests and hands the registry to routes', async () => {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, { capabilities: [fixtureCapability('overview')], modules: [] })
    try {
      expect(platform.capabilities.list().map(c => c.id)).toEqual(['overview'])

      const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules })
      app.get('/__capabilities', c => c.json(c.var.capabilities.list().map(cap => cap.id)))
      const res = await app.request('/__capabilities')
      expect(await res.json()).toEqual(['overview'])
    } finally {
      platform.close()
    }
  })
})

describe('daemon boot from the capability definition list', () => {
  const open: Platform[] = []
  const temps: TempDataDir[] = []

  afterEach(async () => {
    await Promise.all(open.splice(0).map(p => p.close()))
    temps.splice(0).forEach(t => t.cleanup())
  })

  function tempDir() {
    const dir = createTempDataDir()
    temps.push(dir)
    return dir
  }

  function start(options: Parameters<typeof startTestPlatform>[1]) {
    const dir = tempDir()
    const platform = startTestPlatform(dir.root, options)
    open.push(platform)
    return { platform, app: platformApp(platform) }
  }

  it('refuses a definition whose manifest needs a plugin type the product lacks, naming both, and touches nothing on disk', () => {
    const dir = tempDir()
    const widgets = fixtureDefinition('widgets', { manifest: fixtureCapability('widgets', ['jira']) })
    const options = { capabilities: [widgets], modules: [] }
    expect(() => startTestPlatform(dir.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(dir.root, options)).toThrow("Capability 'widgets' requires plugin type 'jira', which neither the definition list nor the product supplies.")
    expect(existsSync(dir.root)).toBe(false)
  })

  it('refuses a list missing a declared dependency, naming both sides, and touches nothing on disk', () => {
    const dir = tempDir()
    const options = { capabilities: [fixtureDefinition('team', { dependsOn: ['bots'] })], modules: [] }
    expect(() => startTestPlatform(dir.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(dir.root, options)).toThrow("Capability 'team' depends on 'bots', which is not in the definition list.")
    expect(existsSync(dir.root)).toBe(false)
  })

  it('runs deletion hooks dependents first before deleting a workspace, and keeps the workspace when one throws', async () => {
    const order: string[] = []
    const team = fixtureDefinition('team', {
      start: () => ({
        onWorkspaceDeleted(workspace) {
          if (workspace.slug === 'beta') throw new Error('team keeps beta')
          order.push(`team ${workspace.slug}`)
        },
      }),
    })
    const bots = fixtureDefinition('bots', { dependsOn: ['team'], start: () => ({ onWorkspaceDeleted: async workspace => void order.push(`bots ${workspace.slug}`) }) })
    const { platform, app } = start({ capabilities: [team, bots], modules: [] })
    // No repository capability is booted, so the workspaces have no repository record.
    for (const name of ['alpha', 'beta']) createWorkspace(platform.db, { name })

    expect((await app.request(`${WORKSPACES_PATH}/alpha`, { method: 'DELETE' })).status).toBe(204)
    expect(order).toEqual(['bots alpha', 'team alpha'])
    expect(findWorkspaceBySlug(platform.db, 'alpha')).toBeNull()

    expect((await app.request(`${WORKSPACES_PATH}/beta`, { method: 'DELETE' })).status).toBe(500)
    expect(order).toEqual(['bots alpha', 'team alpha', 'bots beta'])
    expect(findWorkspaceBySlug(platform.db, 'beta')).not.toBeNull()
  })
})
