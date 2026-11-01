import type { ModuleDefinition, ProductConfig } from '@candy-mountain/shared'
import { createCapabilityRegistry, isCapabilityDefinition, type CapabilityRegistry, type CapabilityRegistryEntry } from './capabilities'
import { platformDefinitions } from './platform-capabilities'
import type { AnyPluginType } from './plugins/definition'

/** The shared configuration joined with the runtime pieces the daemon boots from. */
export interface Product {
  config: Readonly<ProductConfig>
  /** Definitions and, for capabilities not yet converted, bare manifests. */
  capabilities: readonly CapabilityRegistryEntry[]
  modules: readonly ModuleDefinition[]
  /** Plugin types no capability brings. */
  pluginTypes: readonly AnyPluginType[]
}

export class ProductError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductError'
  }
}

type IdList = 'capabilities' | 'modules' | 'pluginTypes'

const KINDS: Record<IdList, [singular: string, supplier: string]> = {
  capabilities: ['capability', 'definition'],
  modules: ['module', 'module definition'],
  pluginTypes: ['plugin type', 'definition or product plugin type'],
}

export function suppliedIds(product: Pick<Product, IdList>): Record<IdList, string[]> {
  const brought = product.capabilities.flatMap(entry => (isCapabilityDefinition(entry) ? (entry.pluginTypes ?? []).map(t => t.id) : []))
  return {
    capabilities: product.capabilities.map(entry => entry.id),
    modules: product.modules.map(mod => mod.id),
    pluginTypes: [...product.pluginTypes.map(t => t.id), ...brought],
  }
}

/** Over the platform's own definitions as well, since a product definition may depend on them. */
export function productCapabilityRegistry(product: Pick<Product, 'capabilities' | 'pluginTypes'>): CapabilityRegistry {
  return createCapabilityRegistry([...platformDefinitions(), ...product.capabilities], { pluginTypeIds: product.pluginTypes.map(t => t.id) })
}

/** Both directions are refused so the configuration stays the one place that says what a product includes. */
export function assertProduct(product: Product): void {
  const supplied = suppliedIds(product)
  const problems: string[] = []
  for (const key of Object.keys(KINDS) as IdList[]) {
    const [kind, supplier] = KINDS[key]
    const configured = new Set(product.config[key])
    const have = new Set(supplied[key])
    for (const id of configured) {
      if (!have.has(id)) problems.push(`${kind} '${id}' is listed but no ${supplier} supplies it`)
    }
    for (const id of have) {
      if (!configured.has(id)) problems.push(`${kind} '${id}' is supplied but not listed`)
    }
  }
  if (problems.length) throw new ProductError(`Product '${product.config.name}' configuration does not match the daemon: ${problems.join('; ')}.`)
}
