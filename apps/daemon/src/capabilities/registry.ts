import type { AnyCapabilityManifest } from '@candy-mountain/shared'
import { assertCapability, CapabilityManifestError, duplicates } from './manifest'

export interface CapabilityRegistry {
  /** In registration order. */
  list(): readonly AnyCapabilityManifest[]
  byId(id: string): AnyCapabilityManifest | undefined
  /** Throws for an id that is not registered. */
  get(id: string): AnyCapabilityManifest
  has(id: string): boolean
}

export interface CapabilityRegistryOptions {
  /** When given, every required plugin must be one of these plugin type ids. */
  pluginTypeIds?: Iterable<string>
}

export function createCapabilityRegistry(manifests: readonly AnyCapabilityManifest[], options: CapabilityRegistryOptions = {}): CapabilityRegistry {
  assertManifests(manifests, options)
  const list = Object.freeze([...manifests])
  const byId = new Map<string, AnyCapabilityManifest>(list.map(cap => [cap.id, cap]))
  return {
    list: () => list,
    byId: id => byId.get(id),
    get(id) {
      const cap = byId.get(id)
      if (!cap) throw new Error(`Capability '${id}' is not registered.`)
      return cap
    },
    has: id => byId.has(id),
  }
}

/** Per-manifest checks again (manifests may not have come through defineCapability) plus the cross-manifest ones. */
export function assertManifests(manifests: readonly AnyCapabilityManifest[], { pluginTypeIds }: CapabilityRegistryOptions = {}): void {
  manifests.forEach(assertCapability)

  for (const [what, entries] of [
    ['capability id', manifests.map(c => [c.id, c.id] as const)],
    ['agent id', manifests.flatMap(c => c.agents.map(a => [a.id, c.id] as const))],
    ['tool id', manifests.flatMap(c => c.tools.map(t => [t.id, c.id] as const))],
    ['job id', manifests.flatMap(c => c.jobs.map(j => [j.id, c.id] as const))],
    ['view id', manifests.flatMap(c => c.views.map(v => [v.id, c.id] as const))],
    ['view path', manifests.flatMap(c => c.views.map(v => [v.path, c.id] as const))],
  ] as const) {
    const dup = duplicates(entries.map(([value]) => value))
    if (!dup.length) continue
    const described = dup.map(value => {
      const owners = [...new Set(entries.filter(([v]) => v === value).map(([, owner]) => owner))]
      return `'${value}' (${owners.join(', ')})`
    })
    throw new CapabilityManifestError(`Duplicate ${what}(s) across capabilities: ${described.join('; ')}.`)
  }

  if (pluginTypeIds) {
    const known = new Set(pluginTypeIds)
    for (const cap of manifests) {
      for (const plugin of [...cap.requiresPlugins, ...(cap.requiresAnyPlugins ?? []).flat()]) {
        if (!known.has(plugin)) throw new CapabilityManifestError(`Capability '${cap.id}' requires unknown plugin type '${plugin}'.`)
      }
    }
  }
}
