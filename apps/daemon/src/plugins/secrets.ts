import type { PluginSecrets, PluginTypeInfo } from '@candy-mountain/shared'
import type { SecretsStore } from '../secrets'

export const pluginSecretOwner = (instanceId: string) => `plugin:${instanceId}`

/** A read-only view of one instance's declared secrets; daemon-side only, never handed to routes. */
export function createPluginSecrets(store: Pick<SecretsStore, 'get'>, instanceId: string, type: Pick<PluginTypeInfo, 'id' | 'secretFields'>): PluginSecrets {
  const owner = pluginSecretOwner(instanceId)
  const declared = new Set(type.secretFields.map(f => f.name))
  return Object.freeze({
    get(name: string) {
      if (!declared.has(name)) throw new Error(`Plugin type '${type.id}' declares no secret '${name}'.`)
      return store.get(owner, name)
    },
  })
}
