import { CANDY_MOUNTAIN_PRODUCT, MODULES } from '@candy-mountain/candy-mountain'
import type { Product } from '@crab-shack/platform-daemon'
import { capabilityDefinitions, type CapabilityDefinitionOptions } from './definitions'

export function candyMountainProduct(options: CapabilityDefinitionOptions = {}): Product {
  // Every plugin type comes with the capability that owns it.
  return { config: CANDY_MOUNTAIN_PRODUCT, capabilities: capabilityDefinitions(options), modules: MODULES, pluginTypes: [] }
}

export const CANDY_MOUNTAIN: Product = candyMountainProduct()
