import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
  MANIFEST_ID_PATTERN,
  PLUGIN_FIELD_NAME_PATTERN,
  PLUGIN_SCOPES,
  validatePluginConfig,
  type PluginConfig,
  type PluginConfigField,
  type PluginConfigOf,
  type PluginHealth,
  type PluginInstance,
  type PluginInstanceHealth,
  type PluginSecretField,
  type PluginSecrets,
  type PluginTypeInfo,
} from '../index'
import type { DataPaths } from './data-paths'
import { duplicates } from './manifest'

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

export type PluginHealthInstance = Pick<PluginInstance, 'id' | 'scope' | 'workspaceId'>

export interface PluginDeleteContext<S extends string = string> {
  instance: PluginInstance
  paths: DataPaths
  secrets: PluginSecrets<S>
}

export interface PluginHealthContext<C = PluginConfig, S extends string = string> {
  config: C
  secrets: PluginSecrets<S>
  /** Aborted when the check times out. */
  signal: AbortSignal
  /** Present when the check runs for a stored instance (testPluginInstance); absent from a bare checkPluginHealth call. */
  instance?: PluginHealthInstance
  paths?: DataPaths
}

/** The daemon half of a plugin type: the health check and actions run only there, so this is not in the root entry. */
export interface PluginType<C extends readonly PluginConfigField[] = readonly PluginConfigField[], S extends readonly PluginSecretField[] = readonly PluginSecretField[]> extends PluginTypeInfo {
  configFields: C
  secretFields: S
  // Method syntax keeps specific types assignable to AnyPluginType despite the narrower context.
  healthCheck(context: PluginHealthContext<PluginConfigOf<C>, S[number]['name']>): PluginHealth | Promise<PluginHealth>
  /** Extra per-instance endpoints, mounted at `/plugins/:id/<name>`. */
  actions?: Readonly<Record<string, PluginAction<PluginConfigOf<C>, S[number]['name']>>>
  /** Endpoints of the type itself, mounted at `/plugin-types/:id/<name>`, for checks that need no instance. */
  typeActions?: Readonly<Record<string, PluginTypeAction>>
  /** Runs before an instance or its workspace is deleted, while the row and secrets still exist; a throw stops the delete. */
  onDelete?(context: PluginDeleteContext<S[number]['name']>): void | Promise<void>
}

export type AnyPluginType = PluginType

/** Thrown while defining or registering plugin types, so a bad type stops the daemon at boot. */
export class PluginTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginTypeError'
  }
}

export function definePluginType<const C extends readonly PluginConfigField[], const S extends readonly PluginSecretField[]>(type: PluginType<C, S>): PluginType<C, S> {
  assertPluginType(type as unknown as AnyPluginType)
  return type
}

const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === ''
const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')
const CONFIG_FIELD_KINDS: readonly string[] = ['string', 'select', 'boolean'] satisfies PluginConfigField['kind'][]

export function assertPluginType(type: AnyPluginType): void {
  const fail = (msg: string): never => {
    throw new PluginTypeError(`Plugin type '${String(type.id)}': ${msg}`)
  }
  if (typeof type.id !== 'string' || !MANIFEST_ID_PATTERN.test(type.id)) {
    throw new PluginTypeError(`Invalid plugin type id '${String(type.id)}'; ids are lowercase letters and digits joined by '-', '_' or '.'.`)
  }
  if (isBlank(type.name) || isBlank(type.description)) fail('name and description must not be empty.')
  if (!Array.isArray(type.reach) || !type.reach.length || type.reach.some(isBlank)) fail('needs at least one reach line, none empty.')
  if (!Array.isArray(type.scopes) || !type.scopes.length) fail('needs at least one scope.')
  const badScopes = type.scopes.filter(s => !(PLUGIN_SCOPES as readonly string[]).includes(s))
  if (badScopes.length) fail(`unknown scope(s) ${quoted(badScopes)}; scopes are ${quoted(PLUGIN_SCOPES)}.`)
  if (duplicates(type.scopes).length) fail(`duplicate scope(s) ${quoted(duplicates(type.scopes))}.`)
  if (typeof type.singleInstance !== 'boolean') fail('singleInstance must be true or false.')
  if (typeof type.healthCheck !== 'function') fail('needs a health check.')

  const names = [...type.configFields.map(f => f.name), ...type.secretFields.map(f => f.name)]
  const badNames = names.filter(n => typeof n !== 'string' || !PLUGIN_FIELD_NAME_PATTERN.test(n))
  if (badNames.length) fail(`invalid field name(s) ${quoted(badNames)}; names are camelCase letters and digits.`)
  const dupNames = duplicates(names)
  if (dupNames.length) fail(`duplicate field name(s) ${quoted(dupNames)} across config and secret fields.`)

  for (const field of type.configFields) {
    if (!CONFIG_FIELD_KINDS.includes(field.kind)) fail(`config field '${field.name}' has unknown kind '${String(field.kind)}'.`)
    if (isBlank(field.label)) fail(`config field '${field.name}' needs a label.`)
    if (field.kind === 'string' && field.pattern !== undefined) {
      try {
        new RegExp(field.pattern)
      }
      catch {
        fail(`config field '${field.name}' has an invalid pattern.`)
      }
    }
    if (field.kind === 'select') {
      if (!field.options.length) fail(`select field '${field.name}' needs at least one option.`)
      if (field.options.some(o => isBlank(o.value) || isBlank(o.label))) fail(`select field '${field.name}' has an option without a value or label.`)
      const dupValues = duplicates(field.options.map(o => o.value))
      if (dupValues.length) fail(`select field '${field.name}' repeats option(s) ${quoted(dupValues)}.`)
    }
    if (field.default !== undefined && !validatePluginConfig([field], { [field.name]: field.default }).ok) {
      fail(`config field '${field.name}' has an invalid default.`)
    }
  }
  for (const field of type.secretFields) {
    if (isBlank(field.label)) fail(`secret field '${field.name}' needs a label.`)
  }
  const actionProblems = pluginActionProblems(type.actions)
  if (actionProblems.length) fail(actionProblems[0]!)
  const typeActionProblems = pluginActionProblems(type.typeActions)
  if (typeActionProblems.length) fail(`type ${typeActionProblems[0]!}`)
  if (type.onDelete !== undefined && typeof type.onDelete !== 'function') fail('onDelete must be a function.')
}
