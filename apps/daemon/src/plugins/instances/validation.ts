import { isPluginTypeId, PLUGIN_SCOPES, type CreatePluginInstanceRequest, type PluginScope, type PluginSecretValues, type UpdatePluginInstanceRequest } from '@candy-mountain/shared'
import { PluginInstanceError } from './errors'

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function invalid(message: string): never {
  throw new PluginInstanceError('invalid_request', message)
}

function parseSecrets(value: unknown): PluginSecretValues | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) invalid('secrets must be an object of secret name to value')
  for (const [name, secret] of Object.entries(value)) {
    if (secret !== null && typeof secret !== 'string') invalid(`Secret "${name}" must be a string, or null to clear it`)
  }
  return value as PluginSecretValues
}

function parseConfig(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isObject(value)) invalid('config must be an object')
  return value
}

export function parseCreatePluginInstance(body: unknown): CreatePluginInstanceRequest {
  if (!isObject(body)) invalid('Request body must be an object')
  if (typeof body.type !== 'string' || !body.type) invalid('type is required')
  if (!(PLUGIN_SCOPES as readonly unknown[]).includes(body.scope)) invalid(`scope must be one of ${PLUGIN_SCOPES.join(', ')}`)
  if (body.project !== undefined && body.project !== null && typeof body.project !== 'string') invalid('project must be a project slug')
  if (!isPluginTypeId(body.type)) throw new PluginInstanceError('type_not_found', `Plugin type "${body.type}" is not registered`)
  return {
    type: body.type,
    scope: body.scope as PluginScope,
    project: (body.project as string | null | undefined) ?? null,
    config: parseConfig(body.config),
    secrets: parseSecrets(body.secrets),
  }
}

export function parseUpdatePluginInstance(body: unknown): UpdatePluginInstanceRequest {
  if (!isObject(body)) invalid('Request body must be an object')
  const unknown = Object.keys(body).filter(k => k !== 'config' && k !== 'secrets')
  if (unknown.length) invalid(`Only config and secrets can be changed, not ${unknown.join(', ')}`)
  return { config: parseConfig(body.config), secrets: parseSecrets(body.secrets) }
}
