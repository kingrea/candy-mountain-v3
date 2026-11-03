import type { CapabilityId, WorkspaceFactId } from './capabilities'
import type { PluginTypeId } from './plugins'

export type ModuleId = string

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

export const workspaceModulesPath = (slug: string) => `/workspaces/${slug}/modules`

export interface WorkspaceModulesResponse {
  modules: ModuleId[]
}

export interface SetWorkspaceModulesRequest {
  modules: ModuleId[]
}

export const WORKSPACE_MODULES_ERROR_CODES = ['invalid_request', 'module_not_found'] as const
export type WorkspaceModulesErrorCode = (typeof WORKSPACE_MODULES_ERROR_CODES)[number]

export const MODULES_PATH = '/modules'

export interface ModuleCapabilityInfo extends ModuleMember {
  label: string
  description: string
  requiresPlugins: readonly string[]
  requiresAnyPlugins: readonly (readonly PluginTypeId[])[]
  requiresWorkspaceFacts: readonly WorkspaceFactId[]
}

/** A module definition with each member's manifest details, so a client can show what a disabled module needs. */
export interface ModuleInfo extends Omit<ModuleDefinition, 'capabilities'> {
  capabilities: ModuleCapabilityInfo[]
}

export interface ModuleListResponse {
  modules: ModuleInfo[]
}
