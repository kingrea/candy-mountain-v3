import type { ModuleInfo, PluginInstance, PluginScope, PluginTypeInfo } from '@candy-mountain/shared'
import { SCOPE } from './scope-label'

export interface ModulePluginNeed {
  typeId: string
  name: string
  /** Labels of the module's capabilities that need it. */
  neededBy: string[]
  /** Other plugin types that would do instead; empty when it is required outright. */
  alternatives: string[]
}

export type PluginHealthState = 'healthy' | 'unhealthy' | 'untested' | 'secrets-missing' | 'missing'

export interface PluginHealthSummary {
  state: PluginHealthState
  /** Which instance the project resolves to; null when there is none. */
  scope: PluginScope | null
  detail: string
}

const nameOf = (types: readonly PluginTypeInfo[], typeId: string) => types.find(type => type.id === typeId)?.name ?? typeId

export function modulePluginNeeds(mod: ModuleInfo, types: readonly PluginTypeInfo[]): ModulePluginNeed[] {
  const needs = new Map<string, { neededBy: Set<string>, alternatives: Set<string>, required: boolean }>()
  const need = (typeId: string) => {
    let entry = needs.get(typeId)
    if (!entry) needs.set(typeId, entry = { neededBy: new Set(), alternatives: new Set(), required: false })
    return entry
  }
  for (const cap of mod.capabilities) {
    for (const typeId of cap.requiresPlugins) {
      const entry = need(typeId)
      entry.required = true
      entry.neededBy.add(cap.label)
    }
    for (const group of cap.requiresAnyPlugins) {
      for (const typeId of group) {
        const entry = need(typeId)
        entry.neededBy.add(cap.label)
        group.filter(other => other !== typeId).forEach(other => entry.alternatives.add(nameOf(types, other)))
      }
    }
  }
  return [...needs].map(([typeId, entry]) => ({
    typeId,
    name: nameOf(types, typeId),
    neededBy: [...entry.neededBy],
    alternatives: entry.required ? [] : [...entry.alternatives],
  }))
}

// Mirrors the daemon's readiness: the project's own instance wins, else the platform's, judged on stored health only.
export function pluginHealth(typeId: string, types: readonly PluginTypeInfo[], instances: readonly PluginInstance[]): PluginHealthSummary {
  const instance = instances.find(candidate => candidate.type === typeId && candidate.scope === 'project')
    ?? instances.find(candidate => candidate.type === typeId && candidate.scope === 'global')
  if (!instance) return { state: 'missing', scope: null, detail: `Not configured for this ${SCOPE.singular} or the platform.` }

  const { scope } = instance
  const owner = scope === 'project' ? `This ${SCOPE.singular}'s instance` : 'The platform instance'
  const missing = (types.find(type => type.id === typeId)?.secretFields ?? [])
    .filter(field => field.required && instance.secrets[field.name] !== 'set')
    .map(field => field.label)
  if (missing.length) return { state: 'secrets-missing', scope, detail: `${owner} is missing ${missing.join(', ')}.` }
  if (!instance.health) return { state: 'untested', scope, detail: `${owner} has not been tested since it was last changed.` }
  if (!instance.health.healthy) return { state: 'unhealthy', scope, detail: `${owner} is unhealthy: ${instance.health.reason}` }
  return { state: 'healthy', scope, detail: instance.health.detail ?? `${owner} passed its last connection test.` }
}

export function toggledModules<T extends string>(order: readonly T[], enabled: readonly T[], id: T, on: boolean): T[] {
  return order.filter(candidate => (candidate === id ? on : enabled.includes(candidate)))
}
