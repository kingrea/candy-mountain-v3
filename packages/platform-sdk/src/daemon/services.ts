import { MANIFEST_ID_PATTERN } from '../index'
import { CapabilityDefinitionError } from './capability'

declare const SERVICE_TYPE: unique symbol

/** A typed name for a service one definition binds and others look up; the type parameter is compile-time only. */
export interface ServiceKey<T> {
  readonly name: string
  readonly [SERVICE_TYPE]?: T
}

export function serviceKey<T>(name: string): ServiceKey<T> {
  if (!MANIFEST_ID_PATTERN.test(name)) throw new CapabilityDefinitionError(`Invalid service key '${name}'; keys are lowercase letters and digits joined by '-', '_' or '.'.`)
  return Object.freeze({ name })
}

export type ServiceBinding<T = unknown> = readonly [key: ServiceKey<T>, value: T]

export const bindService = <T>(key: ServiceKey<T>, value: T): ServiceBinding<T> => [key, value]

export interface BoundServices {
  /** Throws for a key nothing in this set binds. */
  get<T>(key: ServiceKey<T>): T
  has(key: ServiceKey<unknown>): boolean
}
