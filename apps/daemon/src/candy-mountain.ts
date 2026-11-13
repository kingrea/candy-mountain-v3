import { CANDY_MOUNTAIN_PRODUCT, MODULES } from '@candy-mountain/candy-mountain'
import type { Product } from '@crab-shack/platform-daemon'
import { capabilityDefinitions, type CapabilityDefinitionOptions } from './definitions'
import { candyMountainSettings } from './settings'

/** `env` overrides the product's settings; only the entry point passes the process environment. */
export function candyMountainProduct(options: CapabilityDefinitionOptions = {}, env: NodeJS.ProcessEnv = {}): Product {
  // Every plugin type comes with the capability that owns it.
  return { config: CANDY_MOUNTAIN_PRODUCT, capabilities: capabilityDefinitions(options), modules: MODULES, pluginTypes: [], settings: candyMountainSettings(env) }
}

export const CANDY_MOUNTAIN: Product = candyMountainProduct()
