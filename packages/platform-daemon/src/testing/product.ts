import type { ProductConfig } from '@candy-mountain/platform-sdk'
import { suppliedIds, type Product } from '../product'

/** A product with nothing of its own; `testProduct` lists whatever parts a test supplies. */
export const TEST_PRODUCT_CONFIG: Readonly<ProductConfig> = Object.freeze({
  name: 'Test Product',
  description: 'A product for platform tests.',
  theme: { primary: 'sky', hex: '#0ea5e9' },
  scope: { label: { singular: 'workspace', plural: 'workspaces', singularTitle: 'Workspace', pluralTitle: 'Workspaces' }, urlPrefix: 'w', listPath: 'workspaces' },
  capabilities: [],
  modules: [],
  pluginTypes: [],
  layers: [],
})

export type ProductParts = Partial<Pick<Product, 'capabilities' | 'modules' | 'pluginTypes'>>

/** The configuration's ids follow the parts, so only the parts themselves are validated. */
export function testProduct({ capabilities = [], modules = [], pluginTypes = [] }: ProductParts = {}, config: Partial<ProductConfig> = {}): Product {
  const parts = { capabilities, modules, pluginTypes }
  const ids = suppliedIds(parts)
  return { config: { ...TEST_PRODUCT_CONFIG, ...config, capabilities: ids.capabilities, modules: ids.modules, pluginTypes: [...new Set(ids.pluginTypes)] }, ...parts }
}
