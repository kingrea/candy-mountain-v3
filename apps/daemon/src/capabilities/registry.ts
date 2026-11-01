import type { AnyCapabilityManifest } from '@candy-mountain/shared'
import { assertCapabilityDefinition, CapabilityDefinitionError, isCapabilityDefinition, type CapabilityDefinition } from './definition'
import { assertCapability, CapabilityManifestError, duplicates } from './manifest'

export type CapabilityRegistryEntry = AnyCapabilityManifest | CapabilityDefinition

export interface CapabilityRegistry {
  /** Manifests in registration order; a service-only definition has none and is absent here. */
  list(): readonly AnyCapabilityManifest[]
  byId(id: string): AnyCapabilityManifest | undefined
  /** Throws for an id that is not registered. */
  get(id: string): AnyCapabilityManifest
  has(id: string): boolean
  /** Runtime definitions in registration order; bare manifests have none. */
  definitions(): readonly CapabilityDefinition[]
}

export interface CapabilityRegistryOptions {
  /** When given, every required plugin must be one of these plugin type ids or one a definition in the list brings. */
  pluginTypeIds?: Iterable<string>
  /** Session family ids the product supplies itself; a definition may not register one of them again. */
  familyIds?: Iterable<string>
}

const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')

export function createCapabilityRegistry(entries: readonly CapabilityRegistryEntry[], options: CapabilityRegistryOptions = {}): CapabilityRegistry {
  const definitions = Object.freeze(entries.filter(isCapabilityDefinition))
  assertCapabilityDefinitions(definitions, options)
  const list = Object.freeze(entries.flatMap(entry => (isCapabilityDefinition(entry) ? (entry.manifest ? [entry.manifest] : []) : [entry])))
  const brought = definitions.flatMap(d => (d.pluginTypes ?? []).map(t => t.id))
  assertManifests(list, options.pluginTypeIds ? { pluginTypeIds: [...options.pluginTypeIds, ...brought] } : {})

  const taken = new Set(list.map(cap => cap.id))
  for (const definition of definitions) {
    if (!definition.manifest && taken.has(definition.id)) throw new CapabilityDefinitionError(`Capability '${definition.id}' is both a service-only definition and a manifest.`)
  }

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
    definitions: () => definitions,
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

/**
 * Per-definition checks again plus the cross-definition ones. A manifest's required plugin types are always checked here,
 * against the product's and what the list brings, since a definition list is what a product boots from.
 */
export function assertCapabilityDefinitions(definitions: readonly CapabilityDefinition[], { pluginTypeIds, familyIds }: CapabilityRegistryOptions = {}): void {
  definitions.forEach(assertCapabilityDefinition)

  const dupIds = duplicates(definitions.map(d => d.id))
  if (dupIds.length) throw new CapabilityDefinitionError(`Capability ${quoted(dupIds)} is defined more than once; each capability appears once in the definition list.`)

  orderCapabilityDefinitions(definitions)

  const supplied = new Set(pluginTypeIds ?? [])
  const broughtBy = new Map<string, string>()
  for (const definition of definitions) {
    for (const type of definition.pluginTypes ?? []) {
      if (supplied.has(type.id)) throw new CapabilityDefinitionError(`Plugin type '${type.id}' is brought by capability '${definition.id}' but the product already supplies it.`)
      const other = broughtBy.get(type.id)
      if (other) throw new CapabilityDefinitionError(`Plugin type '${type.id}' is brought by both capability '${other}' and capability '${definition.id}'.`)
      broughtBy.set(type.id, definition.id)
    }
  }
  for (const { id, manifest } of definitions) {
    if (!manifest) continue
    for (const plugin of [...manifest.requiresPlugins, ...(manifest.requiresAnyPlugins ?? []).flat()]) {
      if (!supplied.has(plugin) && !broughtBy.has(plugin)) {
        throw new CapabilityDefinitionError(`Capability '${id}' requires plugin type '${plugin}', which neither the definition list nor the product supplies.`)
      }
    }
  }

  const suppliedFamilies = new Set(familyIds ?? [])
  const familyOwners = new Map<string, string>()
  for (const definition of definitions) {
    for (const family of definition.sessionFamilies ?? []) {
      if (suppliedFamilies.has(family.id)) throw new CapabilityDefinitionError(`Session family '${family.id}' is registered by capability '${definition.id}' but the product already supplies it.`)
      const other = familyOwners.get(family.id)
      if (other) throw new CapabilityDefinitionError(`Session family '${family.id}' is registered by both capability '${other}' and capability '${definition.id}'.`)
      familyOwners.set(family.id, definition.id)
    }
  }

  const providedBy = new Map<string, string>()
  for (const definition of definitions) {
    for (const key of definition.provides ?? []) {
      const other = providedBy.get(key.name)
      if (other) throw new CapabilityDefinitionError(`Service '${key.name}' is provided by both capability '${other}' and capability '${definition.id}'.`)
      providedBy.set(key.name, definition.id)
    }
  }
}

/** Dependencies before dependents, list order otherwise; refuses a missing dependency or a cycle naming the capabilities involved. */
export function orderCapabilityDefinitions(definitions: readonly CapabilityDefinition[]): CapabilityDefinition[] {
  const byId = new Map(definitions.map(d => [d.id, d]))
  const ordered: CapabilityDefinition[] = []
  const done = new Set<string>()
  const path: string[] = []

  const visit = (definition: CapabilityDefinition) => {
    if (done.has(definition.id)) return
    const at = path.indexOf(definition.id)
    if (at >= 0) throw new CapabilityDefinitionError(`Capability dependencies form a cycle: ${quoted([...path.slice(at), definition.id]).replaceAll(', ', ' -> ')}.`)
    path.push(definition.id)
    for (const id of definition.dependsOn ?? []) {
      const dependency = byId.get(id)
      if (!dependency) throw new CapabilityDefinitionError(`Capability '${definition.id}' depends on '${id}', which is not in the definition list.`)
      visit(dependency)
    }
    path.pop()
    done.add(definition.id)
    ordered.push(definition)
  }

  definitions.forEach(visit)
  return ordered
}
