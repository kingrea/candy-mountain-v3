import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/shared'
import { createApp, type AppDeps } from '../app'
import { CANDY_MOUNTAIN } from '../candy-mountain'
import { startPlatform, type Platform, type PlatformOptions } from '../platform'
import { suppliedIds, type Product } from '../product'

/** Candy Mountain's definitions as the entry point boots them; tests filter or swap entries to build a product. */
export const CAPABILITY_DEFINITIONS = CANDY_MOUNTAIN.capabilities

export type ProductParts = Partial<Pick<Product, 'capabilities' | 'modules' | 'pluginTypes'>>

/** Candy Mountain with parts swapped; the configuration's ids follow them, so only the parts themselves are validated. */
export function candyMountainWith(parts: ProductParts): Product {
  const product = { ...CANDY_MOUNTAIN, ...parts }
  const ids = suppliedIds(product)
  return { ...product, config: { ...CANDY_MOUNTAIN_PRODUCT, capabilities: ids.capabilities, modules: ids.modules, pluginTypes: [...new Set(ids.pluginTypes)] } }
}

/** Candy Mountain's definitions without the given ids, with the modules that list them trimmed and any left empty dropped. */
export function withoutCapabilities(...ids: string[]): Required<Pick<ProductParts, 'capabilities' | 'modules'>> {
  return {
    capabilities: CAPABILITY_DEFINITIONS.filter(c => !ids.includes(c.id)),
    modules: CANDY_MOUNTAIN.modules.map(m => ({ ...m, capabilities: m.capabilities.filter(c => !ids.includes(c.capabilityId)) })).filter(m => m.capabilities.length > 0),
  }
}

export type TestPlatformOptions = Omit<PlatformOptions, 'product'> & ProductParts & {
  /** Defaults to Candy Mountain, with any parts given swapped in. */
  product?: Product
}

/** A platform booting a subset of Candy Mountain's parts, or stand-ins for them. */
export function startTestPlatform(dataDir: string, { product, capabilities, modules, pluginTypes, ...options }: TestPlatformOptions = {}): Platform {
  const parts = Object.fromEntries(Object.entries({ capabilities, modules, pluginTypes }).filter(([, part]) => part !== undefined))
  return startPlatform(dataDir, { product: product ?? (Object.keys(parts).length ? candyMountainWith(parts) : CANDY_MOUNTAIN), ...options })
}

export type TestAppDeps = Omit<AppDeps, 'product'> & { product?: Product }

/** An app for route tests that pass their own registries or runtime; the product defaults to Candy Mountain. */
export function createTestApp({ product = CANDY_MOUNTAIN, ...deps }: TestAppDeps): ReturnType<typeof createApp> {
  return createApp({ product, ...deps })
}

/** The app the entry point would build over this platform. */
export function platformApp(platform: Platform, deps: Partial<AppDeps> = {}): ReturnType<typeof createApp> {
  return createApp({
    db: platform.db,
    paths: platform.paths,
    product: platform.product,
    capabilities: platform.capabilities,
    modules: platform.modules,
    pluginTypes: platform.pluginTypes,
    families: platform.families,
    secrets: platform.secrets.writeOnly,
    secretsReader: platform.secrets,
    runtime: platform.runtime,
    ...deps,
  })
}
