export const PLUGIN_TYPE_IDS = ['repository', 'claude-code', 'codex', 'netlify', 'heroku', 'slack'] as const
export type PluginTypeId = (typeof PLUGIN_TYPE_IDS)[number]

export function isPluginTypeId(value: unknown): value is PluginTypeId {
  return typeof value === 'string' && (PLUGIN_TYPE_IDS as readonly string[]).includes(value)
}

/** 'project' instances belong to one project; 'global' instances belong to the platform. */
export const PLUGIN_SCOPES = ['project', 'global'] as const
export type PluginScope = (typeof PLUGIN_SCOPES)[number]

/** Config and secret field names; camelCase so they read naturally as object keys and fit secrets store names. */
export const PLUGIN_FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/

interface PluginConfigFieldBase<N extends string = string> {
  name: N
  label: string
  description?: string
  /** A required field with no default must be supplied. */
  required?: boolean
}

export interface PluginStringField<N extends string = string> extends PluginConfigFieldBase<N> {
  kind: 'string'
  placeholder?: string
  /** RegExp source the trimmed value must match in full. */
  pattern?: string
  default?: string
}

export interface PluginSelectOption<V extends string = string> {
  value: V
  label: string
}

export interface PluginSelectField<N extends string = string, V extends string = string> extends PluginConfigFieldBase<N> {
  kind: 'select'
  options: readonly PluginSelectOption<V>[]
  default?: NoInfer<V>
}

export interface PluginBooleanField<N extends string = string> extends PluginConfigFieldBase<N> {
  kind: 'boolean'
  default?: boolean
}

export type PluginConfigField = PluginStringField | PluginSelectField | PluginBooleanField
export type PluginConfigFieldKind = PluginConfigField['kind']

export interface PluginSecretField<N extends string = string> {
  name: N
  label: string
  description?: string
  required?: boolean
}

type FieldValue<F> = F extends { kind: 'string' }
  ? string
  : F extends { kind: 'boolean' }
    ? boolean
    : F extends { kind: 'select', options: readonly (infer O)[] }
      ? O extends { value: infer V } ? V : never
      : never

type AlwaysPresent<F> = F extends { required: true } ? true : F extends { default: unknown } ? true : false

/** The validated config object for a list of fields: required or defaulted fields are always present. */
export type PluginConfigOf<F extends readonly PluginConfigField[]> = {
  [K in F[number] as AlwaysPresent<K> extends true ? K['name'] : never]: FieldValue<K>
} & {
  [K in F[number] as AlwaysPresent<K> extends true ? never : K['name']]?: FieldValue<K>
}

export type PluginConfigValue = string | boolean
export type PluginConfig = Record<string, PluginConfigValue>

/** Read access to one instance's own secrets, by declared secret field name. */
export interface PluginSecrets<S extends string = string> {
  get(name: S): string | undefined
}

export type PluginHealth = { healthy: true, detail?: string } | { healthy: false, reason: string }

/** Wire-safe description of a plugin type; the daemon's definition adds the health check. */
export interface PluginTypeInfo {
  id: PluginTypeId
  name: string
  description: string
  /** Plain-language lines on what the platform can do once this is enabled. */
  reach: readonly string[]
  scopes: readonly PluginScope[]
  /** At most one instance per owner (a project, or the platform for global). */
  singleInstance: boolean
  configFields: readonly PluginConfigField[]
  secretFields: readonly PluginSecretField[]
}

export function pluginTypeInfo(type: PluginTypeInfo): PluginTypeInfo {
  const { id, name, description, reach, scopes, singleInstance, configFields, secretFields } = type
  return { id, name, description, reach, scopes, singleInstance, configFields, secretFields }
}

export interface PluginConfigError {
  field: string
  message: string
}

export type PluginConfigResult = { ok: true, config: PluginConfig } | { ok: false, errors: PluginConfigError[] }

/** Strings are trimmed and an empty string counts as absent; unknown keys are rejected. */
export function validatePluginConfig(fields: readonly PluginConfigField[], input: unknown): PluginConfigResult {
  const errors: PluginConfigError[] = []
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ field: '', message: 'Config must be an object.' }] }
  }
  const values = input as Record<string, unknown>
  const config: PluginConfig = {}

  for (const key of Object.keys(values)) {
    if (!fields.some(f => f.name === key)) errors.push({ field: key, message: 'Unknown field.' })
  }

  for (const field of fields) {
    let value = values[field.name]
    if (typeof value === 'string') value = value.trim()
    if (value === undefined || value === null || value === '') {
      if (field.default !== undefined) config[field.name] = field.default
      else if (field.required) errors.push({ field: field.name, message: `${field.label} is required.` })
      continue
    }
    const error = fieldError(field, value)
    if (error) errors.push({ field: field.name, message: error })
    else config[field.name] = value as PluginConfigValue
  }

  return errors.length ? { ok: false, errors } : { ok: true, config }
}

function fieldError(field: PluginConfigField, value: unknown): string | undefined {
  switch (field.kind) {
    case 'string':
      if (typeof value !== 'string') return `${field.label} must be text.`
      if (field.pattern !== undefined && !new RegExp(`^(?:${field.pattern})$`).test(value)) return `${field.label} is not in the expected format.`
      return undefined
    case 'select':
      if (!field.options.some(o => o.value === value)) return `${field.label} must be one of ${field.options.map(o => o.value).join(', ')}.`
      return undefined
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `${field.label} must be true or false.`
  }
}
