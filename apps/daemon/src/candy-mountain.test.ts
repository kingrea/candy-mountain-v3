import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { CAPABILITY_CATALOG_PATH, CANDY_MOUNTAIN_PRODUCT, MODULES_PATH, MONITOR_SOURCES_PATH, WORKSPACES_PATH, type ApiErrorBody, type CapabilityCatalogResponse, type ModuleListResponse } from '@candy-mountain/platform-sdk'
import { assertProduct, createCapabilityRegistry, createModuleRegistry, createPluginTypeRegistry, platformDefinitions, productCapabilityRegistry, ProductError, startPlatform, type Platform, type Product } from '@candy-mountain/platform-daemon'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN } from './candy-mountain'
import { MODULES } from './modules'
import { PLUGIN_TYPES } from './plugins'
import { CAPABILITY_DEFINITIONS, createTempDataDir, platformApp, startTestPlatform, testMigrationSets, type TempDataDir, withoutCapabilities } from './testing'

describe('the Candy Mountain product', () => {
  let temp: TempDataDir
  afterEach(() => temp?.cleanup())

  it('matches its configuration and keeps the product on the platform', async () => {
    expect(() => assertProduct(CANDY_MOUNTAIN)).not.toThrow()
    temp = createTempDataDir()
    const platform = startPlatform(temp.root, { product: CANDY_MOUNTAIN })
    expect(platform.product.config.name).toBe('Candy Mountain')
    expect(platform.migrationSets.map(set => set.id)).toEqual(testMigrationSets().map(set => set.id))
    expect(platform.migrationSets.map(set => set.id).sort()).toEqual(['bots', 'deployments', 'issues', 'platform', 'repository', 'team', 'uptime'])
    await platform.close()
  })

  it('refuses a configuration that drifts from the parts, naming every mismatch', () => {
    temp = createTempDataDir()
    const product: Product = { ...CANDY_MOUNTAIN, config: { ...CANDY_MOUNTAIN_PRODUCT, capabilities: CANDY_MOUNTAIN_PRODUCT.capabilities.filter(id => id !== 'uptime'), modules: [] } }
    expect(() => startPlatform(temp.root, { product })).toThrow(ProductError)
    expect(() => startPlatform(temp.root, { product })).toThrow('capability \'uptime\' is supplied but not listed; module \'issues\' is supplied but not listed; module \'agent-hub\' is supplied but not listed; module \'operations\' is supplied but not listed.')
    expect(existsSync(temp.root)).toBe(false)
  })

  it('loads the real definition list', () => {
    const registry = createCapabilityRegistry([...platformDefinitions(), ...CAPABILITY_DEFINITIONS], { pluginTypeIds: PLUGIN_TYPES.map(t => t.id) })
    expect(registry.get('bots')).toMatchObject({ views: [{ id: 'bots', path: 'bots' }], requiresPlugins: ['repository'], requiresAnyPlugins: [['claude-code', 'codex']] })
    expect(registry.get('team')).toMatchObject({ views: [{ id: 'team', path: 'team' }], requiresPlugins: [], requiresWorkspaceFacts: ['hasBots'] })
    for (const id of ['bots', 'team']) expect(registry.get(id).ladder.map(r => r.name)).toEqual(['none', 'manage'])
    expect(registry.get('deployments')).toMatchObject({ views: [{ id: 'deployments', path: 'deployments' }], requiresPlugins: ['repository'] })
    expect(registry.get('deployments').ladder.map(r => r.name)).toEqual(['none', 'read', 'manage'])
    expect(registry.get('uptime')).toMatchObject({ views: [{ id: 'uptime', path: 'uptime' }], requiresPlugins: [], tools: [{ id: 'uptime.manage' }] })
    expect(registry.get('uptime').ladder.map(r => r.name)).toEqual(['none', 'read', 'manage'])
  })

  it('loads the real plugin type list', () => {
    expect(() => createPluginTypeRegistry(PLUGIN_TYPES)).not.toThrow()
  })

  it('loads the three declared modules, empty ones included', () => {
    const registry = createModuleRegistry(MODULES, productCapabilityRegistry(CANDY_MOUNTAIN))
    expect(registry.list().map(m => m.id)).toEqual(['issues', 'agent-hub', 'operations'])
    expect(registry.get('agent-hub').label).toBe('Agent Hub')
    expect(registry.get('agent-hub').capabilities).toEqual(expect.arrayContaining([{ capabilityId: 'bots', defaultRung: 'manage' }, { capabilityId: 'team', defaultRung: 'manage' }]))
    expect(registry.withCapability('bots').map(m => m.id)).toEqual(['agent-hub'])
    expect(registry.withCapability('team').map(m => m.id)).toEqual(['agent-hub'])
    expect(registry.withCapability('deployments').map(m => m.id)).toEqual(['operations'])
    expect(registry.withCapability('uptime').map(m => m.id)).toEqual(['operations'])
    expect(registry.byId('billing')).toBeUndefined()
    expect(() => registry.get('billing')).toThrow("Module 'billing' is not registered.")
  })

  it('leaves no uptime table when the product has no uptime', () => {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, withoutCapabilities('uptime'))
    try {
      const tables = platform.db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`).map(row => row.name)
      expect(platform.migrationSets.map(set => set.id)).not.toContain('uptime')
      expect(tables.filter(name => name.startsWith('uptime'))).toEqual([])
      expect(tables).toContain('bots')
    }
    finally {
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

    expect(booted.capabilities).toEqual(['overview', 'repository', 'issues', 'slack', 'bots', 'team', 'chat-claude-code', 'chat-codex', 'uptime', 'deployments', 'platform-agent'])
    expect(booted.modules.map(m => m.id)).toEqual(['issues', 'agent-hub', 'operations'])
    expect(booted.pluginTypes).toEqual(['repository', 'slack', 'claude-code', 'codex', 'heroku', 'netlify'])
    expect(booted.families).toEqual(['claude-code', 'codex', 'platform'])
  })

  it('serves the uptime routes with its scheduler running when its definition is in the list', async () => {
    const { platform, app } = start({})

    expect(platform.runtime.started.map(s => s.definition.id)).toEqual(['threads', 'overview', 'repository', 'issues', 'slack', 'chat-claude-code', 'chat-codex', 'bots', 'team', 'uptime', 'deployments', 'platform-agent'])
    expect(existsSync(join(platform.paths.run, 'uptime-scheduler.owner'))).toBe(true)
    expect((await app.request(MONITOR_SOURCES_PATH)).status).toBe(200)
    const monitors = await app.request(`${WORKSPACES_PATH}/nope/monitors`)
    expect(monitors.status).toBe(404)
    expect(((await monitors.json()) as ApiErrorBody).error.code).toBe('not_found')
    expect((await app.request(WORKSPACES_PATH)).status).toBe(200)
  })

  it('boots without uptime, its routes answer not found and everything else is unchanged', async () => {
    const { platform, app } = start(withoutCapabilities('uptime'))

    expect(existsSync(join(platform.paths.run, 'uptime-scheduler.owner'))).toBe(false)
    const sources = await app.request(MONITOR_SOURCES_PATH)
    expect(sources.status).toBe(404)
    expect(await sources.text()).toBe('404 Not Found')
    expect((await app.request(`${WORKSPACES_PATH}/nope/monitors`)).status).toBe(404)
    expect((await app.request(WORKSPACES_PATH)).status).toBe(200)

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
})
