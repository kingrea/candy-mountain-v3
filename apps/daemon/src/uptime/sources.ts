import {
  MONITOR_OPTION_FIELD_KINDS,
  MONITOR_OPTION_NAME_PATTERN,
  MONITOR_SOURCE_ID_PATTERN,
  validateMonitorOptions,
  type MonitorSourceInfo,
} from '@candy-mountain/shared'
import { duplicates } from '../capabilities/manifest'
import type { MonitorCheck } from './check'

/** Kept out of shared so the checker never reaches the web bundle; monitorSourceInfo strips it from the wire. */
export interface MonitorSource extends MonitorSourceInfo {
  check: MonitorCheck
}

/** Thrown while defining or registering monitor sources, so a bad source stops the daemon at boot. */
export class MonitorSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MonitorSourceError'
  }
}

export function defineMonitorSource<const S extends MonitorSource>(source: S): S {
  assertMonitorSource(source)
  return source
}

const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === ''
const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')
const isInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)

export function assertMonitorSource(source: MonitorSource): void {
  if (typeof source.id !== 'string' || !MONITOR_SOURCE_ID_PATTERN.test(source.id)) {
    throw new MonitorSourceError(`Invalid monitor source id '${String(source.id)}'; ids are lowercase letters, digits and dashes.`)
  }
  const fail = (msg: string): never => {
    throw new MonitorSourceError(`Monitor source '${source.id}': ${msg}`)
  }
  if (isBlank(source.label) || isBlank(source.description) || isBlank(source.targetLabel)) fail('label, description and targetLabel must not be empty.')
  if (!Array.isArray(source.fields)) fail('fields must be an array.')
  if (typeof source.check !== 'function') fail('check must be a function.')

  const names = source.fields.map(f => f.name)
  const badNames = names.filter(n => typeof n !== 'string' || !MONITOR_OPTION_NAME_PATTERN.test(n))
  if (badNames.length) fail(`invalid field name(s) ${quoted(badNames)}; names are camelCase letters and digits.`)
  if (duplicates(names).length) fail(`duplicate field name(s) ${quoted(duplicates(names))}.`)

  for (const field of source.fields) {
    if (!MONITOR_OPTION_FIELD_KINDS.includes(field.kind)) fail(`field '${field.name}' has unknown kind '${String(field.kind)}'.`)
    if (isBlank(field.label)) fail(`field '${field.name}' needs a label.`)
    if (field.kind === 'string') {
      if (field.pattern !== undefined) {
        try {
          new RegExp(field.pattern)
        }
        catch {
          fail(`field '${field.name}' has an invalid pattern.`)
        }
      }
      if (field.maxLength !== undefined && (!isInteger(field.maxLength) || field.maxLength < 1)) fail(`field '${field.name}' has an invalid maxLength.`)
    }
    if (field.kind === 'integer') {
      if ((field.min !== undefined && !isInteger(field.min)) || (field.max !== undefined && !isInteger(field.max))) fail(`field '${field.name}' has a non-integer bound.`)
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(`field '${field.name}' has min above max.`)
    }
    if (field.default !== undefined && !validateMonitorOptions([field], { [field.name]: field.default }).ok) {
      fail(`field '${field.name}' has an invalid default.`)
    }
  }
}

export interface MonitorSourceRegistry {
  /** In registration order. */
  list(): readonly MonitorSource[]
  ids(): readonly string[]
  byId(id: string): MonitorSource | undefined
  /** Throws for an id that is not registered. */
  get(id: string): MonitorSource
  has(id: string): boolean
}

export function createMonitorSourceRegistry(sources: readonly MonitorSource[]): MonitorSourceRegistry {
  sources.forEach(assertMonitorSource)
  const dup = duplicates(sources.map(s => s.id))
  if (dup.length) throw new MonitorSourceError(`Duplicate monitor source id(s): ${quoted(dup)}.`)

  const list = Object.freeze([...sources])
  const ids = Object.freeze(list.map(s => s.id))
  const byId = new Map(list.map(s => [s.id, s]))
  return {
    list: () => list,
    ids: () => ids,
    byId: id => byId.get(id),
    get(id) {
      const source = byId.get(id)
      if (!source) throw new Error(`Monitor source '${id}' is not registered.`)
      return source
    },
    has: id => byId.has(id),
  }
}
