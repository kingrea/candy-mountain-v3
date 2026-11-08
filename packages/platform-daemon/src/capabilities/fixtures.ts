import type { AnyCapabilityManifest, CapabilityId } from '@candy-mountain/platform-sdk'
import { dataPaths } from '../data-dir'
import type { Db } from '../db'
import { createModuleRegistry } from '../modules'
import { createPluginTypeRegistry } from '../plugins/registry'
import { productCapabilityRegistry } from '../product'
import { createWorkspaceFactRegistry, declaredWorkspaceFacts } from '../registry/facts'
import { lockedSecretsStore } from '../secrets'
import { TEST_PRODUCT_CONFIG, testProduct } from '../testing/product'
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
      { id: `${id}.search`, kind: 'operation', scope: { dimension: 'workspace', levels: ['own', 'all'] } },
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

/** A start context over the given database with the platform's own definitions, empty registries, locked secrets and no dependency services. */
export function fixtureCapabilityContext(db: Db, overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  const capabilities = overrides.capabilities ?? productCapabilityRegistry(testProduct())
  return {
    db,
    paths: dataPaths('/unused'),
    secrets: lockedSecretsStore(),
    capabilities,
    modules: createModuleRegistry([], capabilities),
    pluginTypes: createPluginTypeRegistry([]),
    families: createSessionFamilyRegistry(SESSION_FAMILIES),
    workspaceFacts: createWorkspaceFactRegistry(declaredWorkspaceFacts(capabilities.definitions())),
    agentMcp: { serversFor: async () => [] },
    scopeUrlPrefix: TEST_PRODUCT_CONFIG.scope.urlPrefix,
    scopeListPath: TEST_PRODUCT_CONFIG.scope.listPath,
    scopeLabel: TEST_PRODUCT_CONFIG.scope.label,
    service(key: ServiceKey<unknown>): never {
      throw new CapabilityDefinitionError(`Fixture context has no service '${key.name}'.`)
    },
    ...overrides,
  }
}

/** For a test channel whose description is never read. */
export const undescribed = (): never => {
  throw new Error('not described')
}
