import type { CapabilityId, ProjectFactId } from './capabilities'
import type { PluginTypeId } from './plugins'

export const MODULE_IDS = ['issues', 'agent-hub', 'operations'] as const
export type ModuleId = (typeof MODULE_IDS)[number]

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && (MODULE_IDS as readonly string[]).includes(value)
}

export interface ModuleMember {
  capabilityId: CapabilityId
  /** The rung a grant on the module gives this capability unless the grant names another. */
  defaultRung: string
}

export interface ModuleDefinition {
  id: ModuleId
  label: string
  description: string
  /** Iconify name, e.g. 'i-lucide-list-todo'. */
  icon: string
  /** A capability may belong to several modules; an empty module is valid and renders nothing. */
  capabilities: readonly ModuleMember[]
}

export const projectModulesPath = (slug: string) => `/projects/${slug}/modules`

export interface ProjectModulesResponse {
  modules: ModuleId[]
}

export interface SetProjectModulesRequest {
  modules: ModuleId[]
}

export const PROJECT_MODULES_ERROR_CODES = ['invalid_request', 'module_not_found'] as const
export type ProjectModulesErrorCode = (typeof PROJECT_MODULES_ERROR_CODES)[number]

export const MODULES_PATH = '/modules'

export interface ModuleCapabilityInfo extends ModuleMember {
  label: string
  description: string
  requiresPlugins: readonly string[]
  requiresAnyPlugins: readonly (readonly PluginTypeId[])[]
  requiresProjectFacts: readonly ProjectFactId[]
}

/** A module definition with each member's manifest details, so a client can show what a disabled module needs. */
export interface ModuleInfo extends Omit<ModuleDefinition, 'capabilities'> {
  capabilities: ModuleCapabilityInfo[]
}

export interface ModuleListResponse {
  modules: ModuleInfo[]
}
