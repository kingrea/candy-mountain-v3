import { existsSync } from 'node:fs'
import { CANDY_MOUNTAIN_PRODUCT, MODULES } from '@candy-mountain/candy-mountain'
import { MODULES_PATH, type ModuleListResponse } from '@crab-shack/platform-sdk'
import { assertProduct, createCapabilityRegistry, createModuleRegistry, isCapabilityDefinition, platformDefinitions, productCapabilityRegistry, ProductError, startPlatform, type Platform, type Product } from '@crab-shack/platform-daemon'
import { createTempDataDir, platformApp, startTestPlatform, type TempDataDir } from '@crab-shack/platform-daemon/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN } from './candy-mountain'
import { capabilityDefinitions, DEFINITIONS } from './definitions'

const definitions = CANDY_MOUNTAIN.capabilities.filter(isCapabilityDefinition)
const sorted = (ids: readonly string[]) => [...ids].sort()

describe('the Candy Mountain product', () => {
  let temp: TempDataDir
  afterEach(() => temp?.cleanup())

  it('matches its configuration and boots the platform\'s set and one for every definition with a schema', async () => {
    expect(() => assertProduct(CANDY_MOUNTAIN)).not.toThrow()
    temp = createTempDataDir()
    const platform = startPlatform(temp.root, { product: CANDY_MOUNTAIN })
    try {
      expect(platform.product.config.name).toBe('Candy Mountain')
      expect(sorted(platform.migrationSets.map(set => set.id))).toEqual(sorted(['platform', ...definitions.filter(d => d.schema).map(d => d.id)]))
    }
    finally {
      await platform.close()
    }
  })

  it('refuses a configuration that drifts from the parts, naming every mismatch', () => {
    temp = createTempDataDir()
    const dropped = CANDY_MOUNTAIN_PRODUCT.capabilities.at(-1)!
    const product: Product = { ...CANDY_MOUNTAIN, config: { ...CANDY_MOUNTAIN_PRODUCT, capabilities: CANDY_MOUNTAIN_PRODUCT.capabilities.filter(id => id !== dropped), modules: [] } }
    expect(() => startPlatform(temp.root, { product })).toThrow(ProductError)
    expect(() => startPlatform(temp.root, { product })).toThrow(`capability '${dropped}' is supplied but not listed; ${MODULES.map(m => `module '${m.id}' is supplied but not listed`).join('; ')}.`)
    expect(existsSync(temp.root)).toBe(false)
  })

  it('keys each definition by its own id and lists them all in the product', () => {
    expect(capabilityDefinitions().map(d => d.id)).toEqual(Object.keys(DEFINITIONS))
    expect(sorted(Object.keys(DEFINITIONS))).toEqual(sorted(CANDY_MOUNTAIN_PRODUCT.capabilities))
  })

  it('loads the real definition list', () => {
    const registry = createCapabilityRegistry([...platformDefinitions(), ...CANDY_MOUNTAIN.capabilities], { pluginTypeIds: [] })
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
})

describe('daemon boot from the capability definition list', () => {
  let temp: TempDataDir | undefined
  let platform: Platform | undefined

  afterEach(async () => {
    await platform?.close()
    temp?.cleanup()
    platform = temp = undefined
  })

  function boot(): Platform {
    temp = createTempDataDir()
    platform = startTestPlatform(temp.root, { product: CANDY_MOUNTAIN })
    return platform
  }

  it('boots Candy Mountain with the capabilities, modules, plugin types and families its configuration and definitions name', async () => {
    const booted = boot()
    const app = platformApp(booted)
    const modules = ((await (await app.request(MODULES_PATH)).json()) as ModuleListResponse).modules

    expect(booted.product.capabilities.map(c => c.id)).toEqual(Object.keys(DEFINITIONS))
    expect(modules.map(m => ({ id: m.id, capabilities: m.capabilities.map(c => c.capabilityId) }))).toEqual(MODULES.map(m => ({ id: m.id, capabilities: m.capabilities.map(c => c.capabilityId) })))
    expect(sorted(booted.pluginTypes.list().map(t => t.id))).toEqual(sorted(CANDY_MOUNTAIN_PRODUCT.pluginTypes))
    expect(sorted(booted.families.list().map(f => f.id))).toEqual(sorted(definitions.flatMap(d => d.sessionFamilies ?? []).map(f => f.id)))
  })

  it('starts every definition after the ones it depends on', () => {
    const started = boot().runtime.started.map(s => s.definition.id)

    expect(sorted(started)).toEqual(sorted(['threads', ...Object.keys(DEFINITIONS)]))
    const late = definitions.flatMap(d => (d.dependsOn ?? []).filter(dep => started.indexOf(dep) > started.indexOf(d.id)).map(dep => `${d.id} before ${dep}`))
    expect(late).toEqual([])
  })
})
