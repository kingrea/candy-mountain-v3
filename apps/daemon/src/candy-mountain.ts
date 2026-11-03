import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/platform-sdk'
import { capabilityDefinitions, type CapabilityDefinitionOptions } from './definitions'
import { MODULES } from './modules'
import { PLUGIN_TYPES } from './plugins'
import type { Product } from '@candy-mountain/platform-daemon'

export function candyMountainProduct(options: CapabilityDefinitionOptions = {}): Product {
  return { config: CANDY_MOUNTAIN_PRODUCT, capabilities: capabilityDefinitions(options), modules: MODULES, pluginTypes: PLUGIN_TYPES }
}

export const CANDY_MOUNTAIN: Product = candyMountainProduct()

