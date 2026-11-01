import { LIVE_VERSION_SOURCES_PATH } from '@candy-mountain/shared'
import { defineCapabilityDefinition, type CapabilityDefinition, type CapabilityRuntime } from '../capabilities/definition'
import { LIVE_VERSION_SOURCE_REGISTRY, LIVE_VERSION_SOURCES } from '../environments/builtin-sources'
import { environmentRoutes, liveVersionSourceRoutes, type EnvironmentRouteOptions } from '../environments/routes'
import { createLiveVersionSourceRegistry, LiveVersionSourceError, type LiveVersionSource, type LiveVersionSourceRegistry } from '../environments/sources'
import type { AnyPluginType } from '../plugins/definition'
import type { SecretsReader } from '../plugins/instances/instances'
import type { PluginTypeRegistry } from '../plugins/registry'
import { herokuPluginType } from '../plugins/types/heroku'
import { netlifyPluginType } from '../plugins/types/netlify'
import { deploymentsCapability } from './manifest'

export const DEPLOYMENTS_PLUGIN_TYPES: readonly AnyPluginType[] = [herokuPluginType, netlifyPluginType]

export interface DeploymentsOptions {
  sources?: readonly LiveVersionSource[]
  fetch?: typeof fetch
}

/** The routes alone, for tests that need no platform. */
export function deploymentsRoutes(secretsReader: SecretsReader, { sources = LIVE_VERSION_SOURCE_REGISTRY, fetch }: EnvironmentRouteOptions = {}): Pick<CapabilityRuntime, 'workspaceRoutes' | 'platformRoutes'> {
  return {
    workspaceRoutes: [environmentRoutes(secretsReader, { sources, fetch })],
    platformRoutes: [{ path: LIVE_VERSION_SOURCES_PATH, routes: liveVersionSourceRoutes(sources) }],
  }
}

export function liveVersionSourceRegistryFor(sources: readonly LiveVersionSource[], pluginTypes: Pick<PluginTypeRegistry, 'has'>): LiveVersionSourceRegistry {
  const registry = createLiveVersionSourceRegistry(sources)
  for (const source of registry.list()) {
    if (source.plugin !== undefined && !pluginTypes.has(source.plugin)) {
      throw new LiveVersionSourceError(`Live-version source '${source.id}': plugin type '${source.plugin}' is not registered.`)
    }
  }
  return registry
}

export function deploymentsDefinition({ sources = LIVE_VERSION_SOURCES, fetch }: DeploymentsOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: deploymentsCapability.id,
    manifest: deploymentsCapability,
    pluginTypes: DEPLOYMENTS_PLUGIN_TYPES,
    start: ({ secrets, pluginTypes }) => deploymentsRoutes(secrets, { sources: liveVersionSourceRegistryFor(sources, pluginTypes), fetch }),
  })
}
