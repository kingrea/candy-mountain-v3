import { DEPLOY_OUTCOMES, LIVE_VERSION_SOURCES_PATH } from './wire'
import { defineCapabilityDefinition, type ActivityEventTypeDeclaration, type CapabilityDefinition, type CapabilityRuntime } from '@candy-mountain/platform-sdk/daemon'
import { LIVE_VERSION_SOURCE_REGISTRY, LIVE_VERSION_SOURCES } from './builtin-sources'
import { environmentRoutes, liveVersionSourceRoutes, type EnvironmentRouteOptions } from './routes'
import { createLiveVersionSourceRegistry, LiveVersionSourceError, type LiveVersionSource, type LiveVersionSourceRegistry } from './sources'
import { type PluginTypeRegistry, type SecretsReader } from '@candy-mountain/platform-daemon'
import { HEROKU_CAPABILITY_ID } from '@candy-mountain/plugin-heroku'
import { NETLIFY_CAPABILITY_ID } from '@candy-mountain/plugin-netlify'
import { deploymentsCapability } from './manifest'
import { srcPath } from './package-root'
import * as deploymentsSchema from './schema'

/** One type for every attempt; the payload's `outcome` says which notification it raises, and an attempt without one raises none. */
export const DEPLOYMENT_ACTIVITY_EVENT_TYPES: readonly ActivityEventTypeDeclaration[] = [
  {
    id: 'deploy.attempted',
    label: 'Deploy',
    icon: 'i-lucide-rocket',
    notifications: [
      { id: 'deploy.succeeded', label: 'A deploy succeeds', matches: payload => payload?.outcome === DEPLOY_OUTCOMES[0] },
      { id: 'deploy.failed', label: 'A deploy fails', matches: payload => payload?.outcome === DEPLOY_OUTCOMES[1] },
    ],
  },
]

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
    dependsOn: [HEROKU_CAPABILITY_ID, NETLIFY_CAPABILITY_ID],
    schema: { schema: deploymentsSchema, migrationsFolder: srcPath('migrations') },
    activityEventTypes: DEPLOYMENT_ACTIVITY_EVENT_TYPES,
    start: ({ secrets, pluginTypes }) => deploymentsRoutes(secrets, { sources: liveVersionSourceRegistryFor(sources, pluginTypes), fetch }),
  })
}
