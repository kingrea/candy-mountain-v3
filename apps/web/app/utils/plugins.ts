import {
  PLUGIN_TYPES_PATH,
  PLUGINS_PATH,
  validatePluginConfig,
  type PluginConfig,
  type PluginConfigError,
  type PluginConfigField,
  type PluginInstance,
  type PluginScope,
  type PluginSecretField,
  type PluginSecretState,
  type PluginSecretValues,
  type PluginTypeInfo,
  type RegistryResponse,
} from '@candy-mountain/shared'
import { SCOPE } from './scope-label'

export const PLUGIN_TYPES_DATA_KEY = 'plugin-types'
export const PLUGINS_DATA_KEY_PREFIX = 'plugins:'

export const pluginsDataKey = (slug: string | null) => `${PLUGINS_DATA_KEY_PREFIX}${slug ?? ''}`

export const pluginInstancePath = (id: string, action?: string) =>
  action ? `${PLUGINS_PATH}/${id}/${action}` : `${PLUGINS_PATH}/${id}`

/** A type's own action (GET|POST /plugin-types/:type/<action>), usable before any instance exists. */
export const pluginTypeActionPath = (typeId: string, action: string) => `${PLUGIN_TYPES_PATH}/${typeId}/${action}`

export const PLUGIN_SCOPE_LABELS: Record<PluginScope, string> = {
  project: `This ${SCOPE.singular}`,
  global: 'Platform-wide',
}

/** Scopes a new instance of the type can still take, given the project's and the platform's instances. */
export function availablePluginScopes(type: PluginTypeInfo, instances: readonly PluginInstance[]): PluginScope[] {
  if (!type.singleInstance) return [...type.scopes]
  return type.scopes.filter(scope => !instances.some(instance => instance.type === type.id && instance.scope === scope))
}

/** Capability labels per plugin type id, for every capability the registry reports as waiting on that type. */
export function pluginsNeededBy(registry: RegistryResponse | null): Record<string, string[]> {
  const neededBy: Record<string, string[]> = {}
  const add = (typeId: string, label: string) => {
    const labels = (neededBy[typeId] ??= [])
    if (!labels.includes(label)) labels.push(label)
  }
  for (const capability of registry?.capabilities ?? []) {
    for (const reason of capability.reasons) {
      if (reason.kind === 'plugin') add(reason.plugin, capability.label)
      else if (reason.kind === 'plugin-any') reason.plugins.forEach(typeId => add(typeId, capability.label))
    }
  }
  return neededBy
}

export interface PluginConfigEntry {
  name: string
  label: string
  value: string
}

export function pluginConfigSummary(fields: readonly PluginConfigField[], config: PluginConfig): PluginConfigEntry[] {
  return fields.flatMap((field) => {
    const value = config[field.name]
    if (value === undefined || value === '') return []
    const shown = field.kind === 'boolean'
      ? (value ? 'Yes' : 'No')
      : field.kind === 'select'
        ? (field.options.find(option => option.value === value)?.label ?? String(value))
        : String(value)
    return [{ name: field.name, label: field.label, value: shown }]
  })
}

/** Select value for an optional select left empty; reka's Select cannot hold '' or null. */
export const PLUGIN_SELECT_NONE = '__none__'

export interface PluginConfigDraft {
  text: Record<string, string>
  choice: Record<string, string | undefined>
  flag: Record<string, boolean>
}

export function pluginConfigDraft(fields: readonly PluginConfigField[], config?: PluginConfig): PluginConfigDraft {
  const draft: PluginConfigDraft = { text: {}, choice: {}, flag: {} }
  for (const field of fields) {
    const stored = config ? config[field.name] : field.default
    switch (field.kind) {
      case 'string':
        draft.text[field.name] = typeof stored === 'string' ? stored : ''
        break
      case 'select':
        draft.choice[field.name] = typeof stored === 'string' ? stored : field.required ? undefined : PLUGIN_SELECT_NONE
        break
      case 'boolean':
        draft.flag[field.name] = stored === true
        break
    }
  }
  return draft
}

/**
 * The config to send: blanks are left out on create and sent as null on update, because the daemon merges an update
 * over the stored config.
 */
export function pluginConfigPayload(
  fields: readonly PluginConfigField[],
  draft: PluginConfigDraft,
  forUpdate = false,
): Record<string, string | boolean | null> {
  const payload: Record<string, string | boolean | null> = {}
  for (const field of fields) {
    const raw = field.kind === 'string'
      ? draft.text[field.name]?.trim()
      : field.kind === 'select'
        ? draft.choice[field.name]
        : draft.flag[field.name] ?? false
    if (raw === undefined || raw === '' || raw === PLUGIN_SELECT_NONE) {
      if (forUpdate) payload[field.name] = null
      continue
    }
    payload[field.name] = raw
  }
  return payload
}

export function pluginConfigErrors(fields: readonly PluginConfigField[], draft: PluginConfigDraft): PluginConfigError[] {
  const result = validatePluginConfig(fields, pluginConfigPayload(fields, draft))
  return result.ok ? [] : result.errors
}

export type PluginSecretMode = 'keep' | 'replace' | 'clear'

export interface PluginSecretDraft {
  mode: PluginSecretMode
  value: string
}

/** A saved secret starts as 'keep' so it is only sent when the admin chooses to replace or clear it. */
export function pluginSecretDrafts(
  fields: readonly PluginSecretField[],
  saved?: Record<string, PluginSecretState>,
): Record<string, PluginSecretDraft> {
  return Object.fromEntries(fields.map(field => [
    field.name,
    { mode: saved?.[field.name] === 'set' ? 'keep' : 'replace', value: '' },
  ]))
}

export function pluginSecretsPayload(
  fields: readonly PluginSecretField[],
  drafts: Record<string, PluginSecretDraft>,
): PluginSecretValues | undefined {
  const payload: PluginSecretValues = {}
  for (const field of fields) {
    const draft = drafts[field.name]
    if (draft?.mode === 'clear') payload[field.name] = null
    else if (draft?.mode === 'replace' && draft.value.trim() !== '') payload[field.name] = draft.value.trim()
  }
  return Object.keys(payload).length ? payload : undefined
}

export function pluginSecretErrors(
  fields: readonly PluginSecretField[],
  drafts: Record<string, PluginSecretDraft>,
  saved?: Record<string, PluginSecretState>,
): PluginConfigError[] {
  const errors: PluginConfigError[] = []
  for (const field of fields) {
    const draft = drafts[field.name]
    const isSet = saved?.[field.name] === 'set'
    const typed = draft?.mode === 'replace' && draft.value.trim() !== ''
    if (draft?.mode === 'clear' && field.required) {
      errors.push({ field: field.name, message: `${field.label} is required and cannot be cleared; replace it instead.` })
    }
    else if (draft?.mode === 'replace' && !typed && isSet) {
      errors.push({ field: field.name, message: 'Enter the new value, or keep the saved one.' })
    }
    else if (field.required && !isSet && !typed) {
      errors.push({ field: field.name, message: `${field.label} is required.` })
    }
  }
  return errors
}
