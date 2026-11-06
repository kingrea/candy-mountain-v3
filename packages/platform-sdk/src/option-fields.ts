export const MONITOR_OPTION_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/

interface MonitorOptionFieldBase {
  name: string
  label: string
  description?: string
  /** A required field with no default must be supplied. */
  required?: boolean
}

export interface MonitorStringField extends MonitorOptionFieldBase {
  kind: 'string'
  placeholder?: string
  /** RegExp source the trimmed value must match in full. */
  pattern?: string
  maxLength?: number
  default?: string
}

export interface MonitorIntegerField extends MonitorOptionFieldBase {
  kind: 'integer'
  placeholder?: string
  min?: number
  max?: number
  default?: number
}

export type MonitorOptionField = MonitorStringField | MonitorIntegerField
export type MonitorOptionFieldKind = MonitorOptionField['kind']
export const MONITOR_OPTION_FIELD_KINDS: readonly MonitorOptionFieldKind[] = ['string', 'integer']

export type MonitorOptionValue = string | number
export type MonitorOptions = Record<string, MonitorOptionValue>

export interface MonitorOptionError {
  field: string
  message: string
}

export type MonitorOptionsResult = { ok: true, options: MonitorOptions } | { ok: false, errors: MonitorOptionError[] }

/** Strings are trimmed and an empty string counts as absent; integers may arrive as digit strings from forms; unknown keys are rejected. */
export function validateMonitorOptions(fields: readonly MonitorOptionField[], input: unknown): MonitorOptionsResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ field: '', message: 'Options must be an object.' }] }
  }
  const values = input as Record<string, unknown>
  const errors: MonitorOptionError[] = []
  const options: MonitorOptions = {}

  for (const key of Object.keys(values)) {
    if (!fields.some(f => f.name === key)) errors.push({ field: key, message: 'Unknown option.' })
  }

  for (const field of fields) {
    let value = values[field.name]
    if (typeof value === 'string') value = value.trim()
    if (value === undefined || value === null || value === '') {
      if (field.default !== undefined) options[field.name] = field.default
      else if (field.required) errors.push({ field: field.name, message: `${field.label} is required.` })
      continue
    }
    const result = field.kind === 'string' ? stringValue(field, value) : integerValue(field, value)
    if (typeof result === 'object') errors.push({ field: field.name, message: result.error })
    else options[field.name] = result
  }

  return errors.length ? { ok: false, errors } : { ok: true, options }
}

function stringValue(field: MonitorStringField, value: unknown): string | { error: string } {
  if (typeof value !== 'string') return { error: `${field.label} must be text.` }
  if (field.maxLength !== undefined && value.length > field.maxLength) return { error: `${field.label} must be at most ${field.maxLength} characters.` }
  if (field.pattern !== undefined && !new RegExp(`^(?:${field.pattern})$`).test(value)) return { error: `${field.label} is not in the expected format.` }
  return value
}

function integerValue(field: MonitorIntegerField, value: unknown): number | { error: string } {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) return { error: `${field.label} must be a whole number.` }
  if (field.min !== undefined && number < field.min) return { error: `${field.label} must be at least ${field.min}.` }
  if (field.max !== undefined && number > field.max) return { error: `${field.label} must be at most ${field.max}.` }
  return number
}
