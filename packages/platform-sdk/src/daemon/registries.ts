import type { AnyCapabilityManifest, ModuleDefinition, PluginTypeId } from '../index'
import type { CapabilityDefinition } from './capability'
import type { AnyPluginType } from './plugin-types'

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

export interface ModuleRegistry {
  /** In registration order. */
  list(): readonly ModuleDefinition[]
  byId(id: string): ModuleDefinition | undefined
  /** Throws for an id that is not registered. */
  get(id: string): ModuleDefinition
  has(id: string): boolean
  withCapability(capabilityId: string): readonly ModuleDefinition[]
}

export interface PluginTypeRegistry {
  /** In registration order. */
  list(): readonly AnyPluginType[]
  ids(): readonly PluginTypeId[]
  byId(id: string): AnyPluginType | undefined
  /** Throws for an id that is not registered. */
  get(id: string): AnyPluginType
  has(id: string): boolean
}
