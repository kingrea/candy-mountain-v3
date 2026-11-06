import { existsSync } from 'node:fs'
import { CANDY_MOUNTAIN_PRODUCT, MODULES } from '@candy-mountain/candy-mountain'
import { CAPABILITY_CATALOG_PATH, MODULES_PATH, WORKSPACES_PATH, type CapabilityCatalogResponse, type ModuleListResponse } from '@candy-mountain/platform-sdk'
import { ACP_SESSIONS } from '@candy-mountain/cap-chat-claude-code'
import { BOT_SESSIONS, BOT_SLACK_ROUTER } from '@candy-mountain/cap-bots'
import { assertProduct, createCapabilityRegistry, createModuleRegistry, isCapabilityDefinition, platformDefinitions, productCapabilityRegistry, ProductError, startPlatform, type Platform, type Product } from '@candy-mountain/platform-daemon'
import { afterEach, describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN } from './candy-mountain'
import { capabilityDefinitions, DEFINITIONS } from './definitions'
import { CAPABILITY_DEFINITIONS, createTempDataDir, platformApp, startTestPlatform, testMigrationSets, type TempDataDir, withoutCapabilities } from './testing'

const definitions = CAPABILITY_DEFINITIONS.filter(isCapabilityDefinition)
const sorted = (ids: readonly string[]) => [...ids].sort()

/** Each product capability another definition depends on, with its dependents. */
const dependencies = [...new Set(definitions.flatMap(d => d.dependsOn ?? []))]
  .filter(id => CANDY_MOUNTAIN_PRODUCT.capabilities.includes(id))
  .map(id => [id, definitions.filter(d => d.dependsOn?.includes(id)).map(d => d.id).join(', ')] as const)

/** Capabilities whose removal leaves every other part of the product as it was: nothing depends on them and they bring no fact, plugin type or family. */
const leaves = definitions
  .filter(d => !dependencies.some(([id]) => id === d.id))
  .filter(d => !d.workspaceFacts?.length && !d.pluginTypes?.length && !d.sessionFamilies?.length)
  .map(d => d.id)

describe('the Candy Mountain product', () => {
  let temp: TempDataDir
  afterEach(() => temp?.cleanup())

  it('matches its configuration and keeps the product on the platform', async () => {
    expect(() => assertProduct(CANDY_MOUNTAIN)).not.toThrow()
    temp = createTempDataDir()
    const platform = startPlatform(temp.root, { product: CANDY_MOUNTAIN })
    expect(platform.product.config.name).toBe('Candy Mountain')
    expect(platform.migrationSets.map(set => set.id)).toEqual(testMigrationSets().map(set => set.id))
    expect(sorted(platform.migrationSets.map(set => set.id))).toEqual(sorted(['platform', ...definitions.filter(d => d.schema).map(d => d.id)]))
    await platform.close()
  })

  it('refuses a configuration that drifts from the parts, naming every mismatch', () => {
    temp = createTempDataDir()
    const dropped = CANDY_MOUNTAIN_PRODUCT.capabilities.at(-1)!
    const product: Product = { ...CANDY_MOUNTAIN, config: { ...CANDY_MOUNTAIN_PRODUCT, capabilities: CANDY_MOUNTAIN_PRODUCT.capabilities.filter(id => id !== dropped), modules: [] } }
    expect(() => startPlatform(temp.root, { product })).toThrow(ProductError)
    expect(() => startPlatform(temp.root, { product })).toThrow(`capability '${dropped}' is supplied but not listed; ${MODULES.map(m => `module '${m.id}' is supplied but not listed`).join('; ')}.`)
    expect(existsSync(temp.root)).toBe(false)
  })

  it('keys each definition by its own id', () => {
    expect(capabilityDefinitions().map(d => d.id)).toEqual(Object.keys(DEFINITIONS))
  })

  it('loads the real definition list', () => {
    const registry = createCapabilityRegistry([...platformDefinitions(), ...CAPABILITY_DEFINITIONS], { pluginTypeIds: [] })
    const withManifest = definitions.filter(d => d.manifest).map(d => d.id)
    expect(withManifest.filter(id => !registry.has(id))).toEqual([])
    expect(withManifest.length).toBeGreaterThan(0)
  })

  it('loads the declared modules with their members', () => {
    const registry = createModuleRegistry(MODULES, productCapabilityRegistry(CANDY_MOUNTAIN))
    expect(registry.list().map(m => m.id)).toEqual([...CANDY_MOUNTAIN_PRODUCT.modules])
    for (const module of MODULES) {
      expect(registry.get(module.id).label).toBe(module.label)
      for (const member of module.capabilities) expect(registry.withCapability(member.capabilityId).map(m => m.id)).toContain(module.id)
    }
    expect(registry.byId('billing')).toBeUndefined()
    expect(() => registry.get('billing')).toThrow("Module 'billing' is not registered.")
  })

  it.each(dependencies)('refuses to boot without %s, which %s depend on, naming the dependency', (dependency) => {
    temp = createTempDataDir()
    expect(() => startTestPlatform(temp.root, withoutCapabilities(dependency))).toThrow(`depends on '${dependency}', which is not in the definition list.`)
    expect(existsSync(temp.root)).toBe(false)
  })

  it('boots without chat-claude-code: bots, chat-codex and team leave with it, Slack routing stays off and the rest still serves', async () => {
    temp = createTempDataDir()
    // Bots and chat-codex depend on chat-claude-code, and team on the hasBots fact bots declares, so a product without it leaves them out too.
    const gone = ['chat-claude-code', 'bots', 'chat-codex', 'team']
    const platform = startTestPlatform(temp.root, withoutCapabilities(...gone))
    try {
      expect(platform.runtime.service(ACP_SESSIONS)).toBeUndefined()
      expect(platform.runtime.service(BOT_SESSIONS)).toBeUndefined()
      expect(platform.runtime.service(BOT_SLACK_ROUTER)).toBeUndefined()
      expect(platform.pluginTypes.has('claude-code')).toBe(false)
      expect(platform.families.list().map(f => f.id)).toEqual(['platform'])
      expect(sorted(platform.runtime.started.map(s => s.definition.id))).toEqual(sorted(['threads', ...CAPABILITY_DEFINITIONS.map(d => d.id).filter(id => !gone.includes(id))]))
      const app = platformApp(platform)
      const sessions = await app.request(`${WORKSPACES_PATH}/nope/sessions`)
      expect(sessions.status).toBe(404)
      expect(await sessions.text()).toBe('404 Not Found')
      expect((await app.request(WORKSPACES_PATH)).status).toBe(200)
    }
    finally {
      await platform.close()
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

  function start(options: Parameters<typeof startTestPlatform>[1]) {
    const dir = createTempDataDir()
    temps.push(dir)
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

  it('boots Candy Mountain with the capabilities, modules, plugin types and families its configuration and definitions name', async () => {
    const booted = await surface(start({}))

    expect(booted.capabilities).toEqual(CAPABILITY_DEFINITIONS.map(d => d.id))
    expect(sorted(booted.capabilities)).toEqual(sorted(CANDY_MOUNTAIN_PRODUCT.capabilities))
    expect(booted.modules.map(m => m.id)).toEqual([...CANDY_MOUNTAIN_PRODUCT.modules])
    expect(sorted(booted.pluginTypes)).toEqual(sorted(CANDY_MOUNTAIN_PRODUCT.pluginTypes))
    expect(sorted(booted.families)).toEqual(sorted(definitions.flatMap(d => d.sessionFamilies ?? []).map(f => f.id)))
  })

  it('starts every definition after the ones it depends on', () => {
    const { platform } = start({})
    const started = platform.runtime.started.map(s => s.definition.id)

    expect(sorted(started)).toEqual(sorted(['threads', ...CAPABILITY_DEFINITIONS.map(d => d.id)]))
    const late = definitions.flatMap(d => (d.dependsOn ?? []).filter(dep => started.indexOf(dep) > started.indexOf(d.id)).map(dep => `${d.id} before ${dep}`))
    expect(late).toEqual([])
  })

  it.each(leaves)('boots without %s and leaves everything else unchanged', async (id) => {
    const full = await surface(start({}))
    const without = await surface(start(withoutCapabilities(id)))
    const drop = (ids: string[]) => ids.filter(other => other !== id)

    expect(without).toEqual({
      capabilities: drop(full.capabilities),
      started: drop(full.started),
      modules: full.modules.map(m => ({ ...m, capabilities: drop(m.capabilities) })).filter(m => m.capabilities.length > 0),
      pluginTypes: full.pluginTypes,
      families: full.families,
      catalog: drop(full.catalog),
    })
  })
})
