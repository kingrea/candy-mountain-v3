import type { AnyCapabilityManifest, CapabilityId } from '@candy-mountain/shared'
import { dataPaths } from '../data-dir'
import { CANDY_MOUNTAIN } from '../candy-mountain'
import type { Db } from '../db'
import { createModuleRegistry, MODULES } from '../modules'
import { createPluginTypeRegistry, PLUGIN_TYPES } from '../plugins'
import { productCapabilityRegistry } from '../product'
import { lockedSecretsStore } from '../secrets'
import { createSessionFamilyRegistry, SESSION_FAMILIES } from '../threads/families'
import { CapabilityDefinitionError, defineCapabilityDefinition, type CapabilityContext, type CapabilityDefinition, type ServiceKey } from './definition'
import { defineCapability } from './manifest'

/** A valid manifest whose view, agent, job and tool ids are prefixed with the capability id, so fixtures for different ids never collide. */
export function fixtureCapability(id: CapabilityId, requiresPlugins: readonly string[] = []): AnyCapabilityManifest {
  return defineCapability({
    id,
    label: `Fixture ${id}`,
    description: `Test fixture for ${id}.`,
    views: [
      { id: `${id}-home`, label: 'Home', icon: 'i-lucide-box', path: id },
      { id: `${id}-admin`, label: 'Admin', icon: 'i-lucide-settings', path: `${id}/admin` },
    ],
    agents: [{ id: `${id}-agent`, label: 'Agent', description: 'Fixture agent.' }],
    jobs: [{ id: `${id}-job`, label: 'Job', description: 'Fixture job.' }],
    requiresPlugins,
    tools: [
      { id: `${id}.read`, kind: 'tool' },
      { id: `${id}.search`, kind: 'operation', scope: { dimension: 'project', levels: ['own', 'all'] } },
    ],
    ladder: [
      { name: 'none', label: 'None', description: 'Nothing.', views: [], chat: false, tools: {} },
      { name: 'read', label: 'Read', description: 'Look only.', views: [`${id}-home`], chat: false, tools: { [`${id}.read`]: {}, [`${id}.search`]: { scope: 'own' } } },
      { name: 'full', label: 'Full', description: 'Everything.', views: [`${id}-home`, `${id}-admin`], chat: true, tools: { [`${id}.read`]: {}, [`${id}.search`]: { scope: 'all' } } },
    ],
  })
}

/** A structural copy that can be broken freely in tests. */
export const cloneManifest = (cap: AnyCapabilityManifest): Mutable<AnyCapabilityManifest> => structuredClone(cap) as Mutable<AnyCapabilityManifest>

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mutable<U>[] : T[K] extends object ? Mutable<T[K]> : T[K] }

/** A valid definition around `fixtureCapability(id)`, or service-only when `manifest` is null. */
export function fixtureDefinition(id: string, overrides: Omit<Partial<CapabilityDefinition>, 'manifest'> & { manifest?: AnyCapabilityManifest | null } = {}): CapabilityDefinition {
  const { manifest, ...rest } = overrides
  return defineCapabilityDefinition({ id, ...(manifest === null ? {} : { manifest: manifest ?? fixtureCapability(id as CapabilityId) }), ...rest })
}

/** A start context over the given database with the real registries, locked secrets and no dependency services. */
export function fixtureCapabilityContext(db: Db, overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  const capabilities = overrides.capabilities ?? productCapabilityRegistry(CANDY_MOUNTAIN)
  return {
    db,
    paths: dataPaths('/unused'),
    secrets: lockedSecretsStore(),
    capabilities,
    // The real modules only validate over the real capabilities.
    modules: createModuleRegistry(overrides.capabilities ? [] : MODULES, capabilities),
    pluginTypes: createPluginTypeRegistry(PLUGIN_TYPES),
    families: createSessionFamilyRegistry(SESSION_FAMILIES),
    agentMcp: { serversFor: async () => [] },
    scopeUrlPrefix: CANDY_MOUNTAIN.config.scope.urlPrefix,
    scopeLabel: CANDY_MOUNTAIN.config.scope.label,
    service(key: ServiceKey<unknown>): never {
      throw new CapabilityDefinitionError(`Fixture context has no service '${key.name}'.`)
    },
    ...overrides,
  }
}
