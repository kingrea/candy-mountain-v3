import type { PluginConfig, PluginInstance, PluginInstanceHealth, PluginSecrets } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { DataPaths } from '../data-dir'

export const PLUGIN_ACTION_METHODS = ['GET', 'POST'] as const
export type PluginActionMethod = (typeof PLUGIN_ACTION_METHODS)[number]

/** Action names become the last path segment of `/plugins/:id/<name>`. */
export const PLUGIN_ACTION_NAME_PATTERN = /^[a-z][a-z0-9-]*$/
export const RESERVED_PLUGIN_ACTION_NAMES: readonly string[] = ['test']

/** Writes go through the instance service, so they validate like a PATCH and reset the stored health. */
export interface PluginSecretsWriter<S extends string = string> {
  set(name: S, value: string): void
  clear(name: S): void
}

export interface PluginActionContext<C = PluginConfig, S extends string = string> {
  instance: PluginInstance
  /** The stored config, re-validated against the type's fields. */
  config: C
  secrets: PluginSecrets<S>
  secretsWriter: PluginSecretsWriter<S>
  request: Request
  /** Aborted when the client disconnects. */
  signal: AbortSignal
  paths: DataPaths
  /** Stores a fresh health check like POST /test; null when the instance changed or vanished meanwhile. Still usable after the request ends. */
  refreshHealth(): Promise<PluginInstanceHealth | null>
  resetHealth(): void
}

export interface PluginAction<C = PluginConfig, S extends string = string> {
  method: PluginActionMethod
  /** Return a JSON-serialisable body (sent with 200) or a Response; throw PluginActionError for an error body. */
  run(context: PluginActionContext<C, S>): unknown
}

/** What a type-level action gets: no instance, config or secrets exist yet. */
export interface PluginTypeActionContext {
  request: Request
  /** Aborted when the client disconnects. */
  signal: AbortSignal
  paths: DataPaths
}

/** An admin-only endpoint of a plugin type itself, mounted at `/plugin-types/:id/<name>`, for checks that precede an instance. */
export interface PluginTypeAction {
  method: PluginActionMethod
  run(context: PluginTypeActionContext): unknown
}

/** Becomes `{ error: { code, message } }` with this status; anything else thrown by an action is a 500. */
export class PluginActionError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string
  readonly headers: Readonly<Record<string, string>>

  constructor(status: ContentfulStatusCode, code: string, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.name = 'PluginActionError'
    this.status = status
    this.code = code
    this.headers = headers
  }
}

export function pluginActionProblems(actions: unknown): string[] {
  if (actions === undefined) return []
  if (actions === null || typeof actions !== 'object' || Array.isArray(actions)) return ['actions must be an object keyed by action name.']
  return Object.entries(actions).flatMap(([name, action]: [string, Partial<PluginAction> | null]) => {
    if (!PLUGIN_ACTION_NAME_PATTERN.test(name)) return [`action name '${name}' must be lowercase letters, digits and dashes.`]
    if (RESERVED_PLUGIN_ACTION_NAMES.includes(name)) return [`action name '${name}' is reserved.`]
    if (!action || !(PLUGIN_ACTION_METHODS as readonly unknown[]).includes(action.method)) return [`action '${name}' needs a method of ${PLUGIN_ACTION_METHODS.join(' or ')}.`]
    if (typeof action.run !== 'function') return [`action '${name}' needs a run function.`]
    return []
  })
}
