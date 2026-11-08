import { CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT, DEVELOPMENT_MODULES, MODULES } from '@candy-mountain/candy-mountain'
import { templateDefinition } from '@candy-mountain/cap-template'
import type { CapabilityRegistryEntry, Product } from '@candy-mountain/platform-daemon'
import { capabilityDefinitions, type CapabilityDefinitionOptions } from './definitions'

/** Definitions only a development run adds after DEFINITIONS; src/index.ts never imports this module, so the bundle carries none of them. */
export const DEVELOPMENT_DEFINITIONS = {
  'template': templateDefinition,
}

type DevelopmentDefinitionId = keyof typeof DEVELOPMENT_DEFINITIONS

export type DevelopmentDefinitionOptions = { [Id in DevelopmentDefinitionId]?: Parameters<(typeof DEVELOPMENT_DEFINITIONS)[Id]>[0] }

export function developmentDefinitions(options: DevelopmentDefinitionOptions = {}): readonly CapabilityRegistryEntry[] {
  return (Object.keys(DEVELOPMENT_DEFINITIONS) as DevelopmentDefinitionId[]).map(id => (DEVELOPMENT_DEFINITIONS[id] as (options?: unknown) => CapabilityRegistryEntry)(options[id]))
}

/** Candy Mountain as `pnpm dev` runs it: the build's product plus the development declaration's parts. */
export function candyMountainDevelopmentProduct(options: CapabilityDefinitionOptions & DevelopmentDefinitionOptions = {}): Product {
  return {
    config: CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT,
    capabilities: [...capabilityDefinitions(options), ...developmentDefinitions(options)],
    modules: [...MODULES, ...DEVELOPMENT_MODULES],
    pluginTypes: [],
  }
}
