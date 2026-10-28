import type { AnyCapabilityManifest, CapabilityId } from '@candy-mountain/shared'
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
