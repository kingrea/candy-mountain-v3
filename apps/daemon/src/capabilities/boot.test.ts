import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CAPABILITY_CATALOG_PATH, MODULES_PATH, MONITOR_SOURCES_PATH, PROJECTS_PATH, type ApiErrorBody, type CapabilityCatalogResponse, type ModuleListResponse } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import type { Platform } from '../platform'
import { CAPABILITY_DEFINITIONS, createTestApp, platformApp, startTestPlatform, withoutCapabilities } from '../testing/platform'
import { createProject, findProjectBySlug } from '../projects/projects'
import { createTempDataDir, type TempDataDir } from '../testing'
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

  /** What the boot log and the setup pages show, so two boots can be compared whole. */
  async function surface({ platform, app }: ReturnType<typeof start>) {
    return {
      capabilities: platform.product.capabilities.map(c => c.id),
      started: platform.runtime.started.map(s => s.definition.id),
      modules: ((await (await app.request(MODULES_PATH)).json()) as ModuleListResponse).modules.map(m => ({ id: m.id, capabilities: m.capabilities.map(c => c.capabilityId) })),
      pluginTypes: platform.pluginTypes.list().map(t => t.id),
      families: platform.families.list().map(f => f.id),
      catalog: ((await (await app.request(CAPABILITY_CATALOG_PATH)).json()) as CapabilityCatalogResponse).capabilities.map(c => c.id),
    }
  }

  it('boots Candy Mountain with the capabilities, modules, plugin types and families the boot log has always listed', async () => {
    const booted = await surface(start({}))

    expect(booted.capabilities).toEqual(['overview', 'issues', 'slack', 'bots', 'team', 'chat-claude-code', 'chat-codex', 'uptime', 'deployments', 'platform-agent'])
    expect(booted.modules.map(m => m.id)).toEqual(['issues', 'agent-hub', 'operations'])
    expect(booted.pluginTypes).toEqual(['repository', 'slack', 'claude-code', 'codex', 'heroku', 'netlify'])
    expect(booted.families).toEqual(['claude-code', 'codex', 'platform'])
  })

  it('serves the uptime routes with its scheduler running when its definition is in the list', async () => {
    const { platform, app } = start({})

    expect(platform.runtime.started.map(s => s.definition.id)).toEqual(['threads', 'overview', 'issues', 'slack', 'chat-claude-code', 'chat-codex', 'bots', 'team', 'uptime', 'deployments', 'platform-agent'])
    expect(existsSync(join(platform.paths.run, 'uptime-scheduler.owner'))).toBe(true)
    expect((await app.request(MONITOR_SOURCES_PATH)).status).toBe(200)
    const monitors = await app.request(`${PROJECTS_PATH}/nope/monitors`)
    expect(monitors.status).toBe(404)
    expect(((await monitors.json()) as ApiErrorBody).error.code).toBe('not_found')
    expect((await app.request(PROJECTS_PATH)).status).toBe(200)
  })

  it('boots without uptime, its routes answer not found and everything else is unchanged', async () => {
    const { platform, app } = start(withoutCapabilities('uptime'))

    expect(existsSync(join(platform.paths.run, 'uptime-scheduler.owner'))).toBe(false)
    const sources = await app.request(MONITOR_SOURCES_PATH)
    expect(sources.status).toBe(404)
    expect(await sources.text()).toBe('404 Not Found')
    expect((await app.request(`${PROJECTS_PATH}/nope/monitors`)).status).toBe(404)
    expect((await app.request(PROJECTS_PATH)).status).toBe(200)

    const full = await surface(start({}))
    const dropUptime = (ids: string[]) => ids.filter(id => id !== 'uptime')
    expect(await surface({ platform, app })).toEqual({
      capabilities: dropUptime(full.capabilities),
      started: dropUptime(full.started),
      modules: full.modules.map(m => ({ ...m, capabilities: dropUptime(m.capabilities) })),
      pluginTypes: full.pluginTypes,
      families: full.families,
      catalog: dropUptime(full.catalog),
    })
    expect(full.modules.find(m => m.id === 'operations')?.capabilities).toEqual(['uptime', 'deployments'])
  })

  it('refuses a definition whose manifest needs a plugin type the product lacks, naming both, and touches nothing on disk', () => {
    const dir = tempDir()
    const widgets = fixtureDefinition('widgets', { manifest: fixtureCapability('widgets', ['jira']) })
    const options = { capabilities: [...CAPABILITY_DEFINITIONS, widgets] }
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

  it('runs deletion hooks dependents first before deleting a project, and keeps the project when one throws', async () => {
    const order: string[] = []
    const team = fixtureDefinition('team', {
      start: () => ({
        onWorkspaceDeleted(project) {
          if (project.slug === 'beta') throw new Error('team keeps beta')
          order.push(`team ${project.slug}`)
        },
      }),
    })
    const bots = fixtureDefinition('bots', { dependsOn: ['team'], start: () => ({ onWorkspaceDeleted: async project => void order.push(`bots ${project.slug}`) }) })
    const { platform, app } = start({ capabilities: [team, bots], modules: [] })
    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-boot-'))
    try {
      for (const name of ['alpha', 'beta']) await createProject(platform.db, { name, source: { kind: 'local-path', path: checkout } })

      expect((await app.request(`${PROJECTS_PATH}/alpha`, { method: 'DELETE' })).status).toBe(204)
      expect(order).toEqual(['bots alpha', 'team alpha'])
      expect(findProjectBySlug(platform.db, 'alpha')).toBeNull()

      expect((await app.request(`${PROJECTS_PATH}/beta`, { method: 'DELETE' })).status).toBe(500)
      expect(order).toEqual(['bots alpha', 'team alpha', 'bots beta'])
      expect(findProjectBySlug(platform.db, 'beta')).not.toBeNull()
    }
    finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })
})
