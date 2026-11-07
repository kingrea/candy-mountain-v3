import type { AnyCapabilityManifest, PluginTypeUser } from '@candy-mountain/platform-sdk'
import type { CapabilityRegistry } from '../../capabilities'

/** The capability that brings the type first, when it has a manifest, then every manifest that requires it, in registration order. */
export function pluginTypeUsers(typeId: string, capabilities: Pick<CapabilityRegistry, 'list' | 'definitions'>): PluginTypeUser[] {
  const ownerId = capabilities.definitions().find(definition => definition.pluginTypes?.some(type => type.id === typeId))?.id
  const requires = (cap: AnyCapabilityManifest) =>
    cap.requiresPlugins.includes(typeId) || (cap.requiresAnyPlugins ?? []).some(group => group.includes(typeId))
  const manifests = capabilities.list()
  const owner = manifests.find(cap => cap.id === ownerId)
  const users = [...(owner ? [owner] : []), ...manifests.filter(cap => cap.id !== ownerId && requires(cap))]
  return users.map(cap => ({ id: cap.id, label: cap.label }))
}
