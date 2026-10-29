import {
  isPluginTypeId,
  PLUGIN_FIELD_NAME_PATTERN,
  PLUGIN_SCOPES,
  validatePluginConfig,
  type PluginConfig,
  type PluginConfigField,
  type PluginConfigOf,
  type PluginHealth,
  type PluginInstance,
  type PluginSecretField,
  type PluginSecrets,
  type PluginTypeInfo,
} from '@candy-mountain/shared'
import { duplicates } from '../capabilities/manifest'
import type { DataPaths } from '../data-dir'
import { pluginActionProblems, type PluginAction, type PluginTypeAction } from './actions'

export * from './actions'

export type PluginHealthInstance = Pick<PluginInstance, 'id' | 'scope' | 'projectId'>

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

/** Lives here rather than in shared because the health check runs only in the daemon. */
export interface PluginType<C extends readonly PluginConfigField[] = readonly PluginConfigField[], S extends readonly PluginSecretField[] = readonly PluginSecretField[]> extends PluginTypeInfo {
  configFields: C
  secretFields: S
  // Method syntax keeps specific types assignable to AnyPluginType despite the narrower context.
  healthCheck(context: PluginHealthContext<PluginConfigOf<C>, S[number]['name']>): PluginHealth | Promise<PluginHealth>
  /** Extra per-instance endpoints, mounted at `/plugins/:id/<name>`. */
  actions?: Readonly<Record<string, PluginAction<PluginConfigOf<C>, S[number]['name']>>>
  /** Endpoints of the type itself, mounted at `/plugin-types/:id/<name>`, for checks that need no instance. */
  typeActions?: Readonly<Record<string, PluginTypeAction>>
  /** Runs before an instance or its project is deleted, while the row and secrets still exist; a throw stops the delete. */
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
  if (!isPluginTypeId(type.id)) {
    throw new PluginTypeError(`Unknown plugin type id '${String(type.id)}'; add it to PLUGIN_TYPE_IDS in @candy-mountain/shared first.`)
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
