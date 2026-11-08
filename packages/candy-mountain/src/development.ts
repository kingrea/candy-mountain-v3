import { developmentProductConfig, type ModuleDefinition, type ProductConfig, type ProductDevelopment } from '@candy-mountain/platform-sdk'
import { CANDY_MOUNTAIN_PRODUCT } from './product'

/** A module of its own, so Candy Mountain's real modules never name the template. */
export const TEMPLATE_MODULE: ModuleDefinition = {
  id: 'template',
  label: 'Template',
  description: 'The template capability, a worked example for capability authors.',
  icon: 'i-lucide-layout-template',
  capabilities: [
    { capabilityId: 'template', defaultRung: 'manage' },
  ],
}

/** Included by the daemon's `src/dev.ts` and by `nuxt dev` only: the template exists to be seen running and copied, never to ship. */
export const CANDY_MOUNTAIN_DEVELOPMENT: ProductDevelopment = {
  capabilities: ['template'],
  modules: ['template'],
  pluginTypes: [],
  layers: ['template'],
}

export const DEVELOPMENT_MODULES: readonly ModuleDefinition[] = [TEMPLATE_MODULE]

/** The configuration a development run boots. */
export const CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT: Readonly<ProductConfig> = developmentProductConfig(CANDY_MOUNTAIN_PRODUCT, CANDY_MOUNTAIN_DEVELOPMENT)
