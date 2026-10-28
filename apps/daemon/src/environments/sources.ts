import {
  LIVE_VERSION_SOURCE_ID_PATTERN,
  MONITOR_OPTION_FIELD_KINDS,
  MONITOR_OPTION_NAME_PATTERN,
  validateLiveVersionSettings,
  type LiveVersion,
  type LiveVersionSettingError,
  type LiveVersionSettings,
  type LiveVersionSourceInfo,
  type Project,
} from '@candy-mountain/shared'
import { duplicates } from '../capabilities/manifest'
import type { PluginInstanceDeps, SecretsReader } from '../plugins/instances/instances'

/** Enough to resolve the project's plugin instance and its secrets, for sources that read a vendor plugin. */
export type LiveVersionDeps = PluginInstanceDeps & { secretsReader: SecretsReader }

export interface LiveVersionReadContext {
  settings: LiveVersionSettings
  project: Project
  signal: AbortSignal
  fetch: typeof fetch
  deps: LiveVersionDeps
}

export interface LiveVersionValidateContext {
  projectId: string
  deps: PluginInstanceDeps
}

export interface LiveVersionSource extends LiveVersionSourceInfo {
  /** Checks the field rules cannot express, such as a plugin the source needs; runs after them on every write. */
  validate?: (settings: LiveVersionSettings, context: LiveVersionValidateContext) => LiveVersionSettingError[]
  /** Throws to report a failure; the message is shown against that environment only. */
  read: (context: LiveVersionReadContext) => Promise<LiveVersion>
}

export class LiveVersionSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiveVersionSourceError'
  }
}

export function defineLiveVersionSource<const S extends LiveVersionSource>(source: S): S {
  assertLiveVersionSource(source)
  return source
}

const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === ''
const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')
const isInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value)

export function assertLiveVersionSource(source: LiveVersionSource): void {
  if (typeof source.id !== 'string' || !LIVE_VERSION_SOURCE_ID_PATTERN.test(source.id)) {
    throw new LiveVersionSourceError(`Invalid live-version source id '${String(source.id)}'; ids are lowercase letters, digits and dashes.`)
  }
  const fail = (msg: string): never => {
    throw new LiveVersionSourceError(`Live-version source '${source.id}': ${msg}`)
  }
  if (isBlank(source.label) || isBlank(source.description)) fail('label and description must not be empty.')
  if (typeof source.read !== 'function') fail('read must be a function.')
  if (source.validate !== undefined && typeof source.validate !== 'function') fail('validate must be a function.')
  if (!Array.isArray(source.fields)) fail('fields must be an array.')

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
    if (field.default !== undefined && !validateLiveVersionSettings([field], { [field.name]: field.default }).ok) {
      fail(`field '${field.name}' has an invalid default.`)
    }
  }
}

export interface LiveVersionSourceRegistry {
  /** In registration order. */
  list(): readonly LiveVersionSource[]
  ids(): readonly string[]
  byId(id: string): LiveVersionSource | undefined
  /** Throws for an id that is not registered. */
  get(id: string): LiveVersionSource
  has(id: string): boolean
}

export function createLiveVersionSourceRegistry(sources: readonly LiveVersionSource[]): LiveVersionSourceRegistry {
  sources.forEach(assertLiveVersionSource)
  const dup = duplicates(sources.map(s => s.id))
  if (dup.length) throw new LiveVersionSourceError(`Duplicate live-version source id(s): ${quoted(dup)}.`)

  const list = Object.freeze([...sources])
  const ids = Object.freeze(list.map(s => s.id))
  const byId = new Map(list.map(s => [s.id, s]))
  return {
    list: () => list,
    ids: () => ids,
    byId: id => byId.get(id),
    get(id) {
      const source = byId.get(id)
      if (!source) throw new Error(`Live-version source '${id}' is not registered.`)
      return source
    },
    has: id => byId.has(id),
  }
}
