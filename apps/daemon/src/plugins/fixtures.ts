import type { PluginHealth, PluginTypeId } from '@candy-mountain/shared'
import { definePluginType, type AnyPluginType } from './definition'

/** A valid project-scoped type with one config field of each kind and one secret; healthy when the token is set. */
export function fixturePluginType(id: PluginTypeId, health?: () => PluginHealth | Promise<PluginHealth>): AnyPluginType {
  return definePluginType({
    id,
    name: `Fixture ${id}`,
    description: `Test fixture for ${id}.`,
    reach: [`Read things from ${id}.`],
    scopes: ['project'],
    singleInstance: true,
    configFields: [
      { kind: 'select', name: 'host', label: 'Host', options: [{ value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }], default: 'alpha' },
      { kind: 'string', name: 'account', label: 'Account', required: true, pattern: '[a-z0-9-]+' },
      { kind: 'boolean', name: 'verbose', label: 'Verbose' },
    ],
    secretFields: [{ name: 'token', label: 'Token', required: true }],
    healthCheck: ({ secrets }) => health?.() ?? (secrets.get('token') ? { healthy: true } : { healthy: false, reason: 'Token is not set.' }),
  })
}

/** A structural copy that can be broken freely in tests. */
export const clonePluginType = (type: AnyPluginType): Mutable<AnyPluginType> => ({ ...structuredClone({ ...type, healthCheck: undefined }), healthCheck: type.healthCheck }) as Mutable<AnyPluginType>

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mutable<U>[] : T[K] extends (...args: never[]) => unknown ? T[K] : T[K] extends object ? Mutable<T[K]> : T[K] }
