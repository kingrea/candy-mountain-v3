import type { PluginTypeId } from '@candy-mountain/shared'
import { duplicates } from '../capabilities/manifest'
import { assertPluginType, PluginTypeError, type AnyPluginType } from './definition'

export interface PluginTypeRegistry {
  /** In registration order. */
  list(): readonly AnyPluginType[]
  ids(): readonly PluginTypeId[]
  byId(id: string): AnyPluginType | undefined
  /** Throws for an id that is not registered. */
  get(id: string): AnyPluginType
  has(id: string): boolean
}

export function createPluginTypeRegistry(types: readonly AnyPluginType[]): PluginTypeRegistry {
  types.forEach(assertPluginType)
  const dup = duplicates(types.map(t => t.id))
  if (dup.length) throw new PluginTypeError(`Duplicate plugin type id(s): ${dup.map(id => `'${id}'`).join(', ')}.`)

  const list = Object.freeze([...types])
  const ids = Object.freeze(list.map(t => t.id))
  const byId = new Map<string, AnyPluginType>(list.map(t => [t.id, t]))
  return {
    list: () => list,
    ids: () => ids,
    byId: id => byId.get(id),
    get(id) {
      const type = byId.get(id)
      if (!type) throw new Error(`Plugin type '${id}' is not registered.`)
      return type
    },
    has: id => byId.has(id),
  }
}
