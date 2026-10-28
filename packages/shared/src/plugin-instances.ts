import type { PluginConfig, PluginHealth, PluginScope, PluginTypeId, PluginTypeInfo } from './plugins'

export const PLUGINS_PATH = '/plugins'
export const PLUGIN_TYPES_PATH = '/plugin-types'

export const PLUGIN_SECRET_STATES = ['set', 'unset'] as const
export type PluginSecretState = (typeof PLUGIN_SECRET_STATES)[number]

export type PluginInstanceHealth = PluginHealth & { checkedAt: string }

export interface PluginInstance {
  id: string
  type: PluginTypeId
  scope: PluginScope
  /** Null for global instances. */
  projectId: string | null
  projectSlug: string | null
  config: PluginConfig
  /** Every secret field the type declares; values are never sent. */
  secrets: Record<string, PluginSecretState>
  /** The last "test connection" result; null until tested and again after any config or secret change. */
  health: PluginInstanceHealth | null
  createdAt: string
  updatedAt: string
}

/** A secret value, or null to clear it; an omitted or empty value leaves the secret untouched. */
export type PluginSecretValues = Record<string, string | null>

export interface CreatePluginInstanceRequest {
  type: PluginTypeId
  scope: PluginScope
  /** Project slug; required for project scope, absent for global. */
  project?: string | null
  config?: Record<string, unknown>
  secrets?: PluginSecretValues
}

export interface UpdatePluginInstanceRequest {
  /** Merged over the stored config; a null value removes that field. */
  config?: Record<string, unknown>
  secrets?: PluginSecretValues
}

export interface PluginInstanceListResponse {
  instances: PluginInstance[]
}

export interface PluginInstanceResponse {
  instance: PluginInstance
}

export interface PluginTypeListResponse {
  types: PluginTypeInfo[]
}

export const PLUGIN_INSTANCE_ERROR_CODES = [
  'invalid_request',
  'not_found',
  'project_not_found',
  'type_not_found',
  'unsupported_scope',
  'instance_exists',
  'invalid_config',
  'invalid_secrets',
  'secrets_locked',
  'instance_changed',
  'action_not_found',
] as const
export type PluginInstanceErrorCode = (typeof PLUGIN_INSTANCE_ERROR_CODES)[number]
