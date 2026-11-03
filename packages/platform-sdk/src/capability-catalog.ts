import type { CapabilityId } from './capabilities'
import type { ModuleId } from './modules'

export const CAPABILITY_CATALOG_PATH = '/capabilities'

export interface CatalogRung {
  name: string
  label: string
}

export interface CatalogCapability {
  id: CapabilityId
  label: string
  /** Modules that list this capability; empty for a standalone capability. */
  moduleIds: ModuleId[]
  /** Ascending, 'none' first. */
  rungs: CatalogRung[]
}

export interface CatalogModule {
  id: ModuleId
  label: string
}

export interface CapabilityCatalogResponse {
  capabilities: CatalogCapability[]
  modules: CatalogModule[]
}
