import { CapabilityDefinitionError, type BoundServices, type CapabilityDefinition, type CapabilityRuntime, type ServiceKey } from '@candy-mountain/platform-sdk/daemon'

export {
  assertCapabilityDefinition,
  bindService,
  CapabilityDefinitionError,
  defineCapabilityDefinition,
  isCapabilityDefinition,
  serviceKey,
  type BoundServices,
  type CapabilityContext,
  type CapabilityDefinition,
  type CapabilityRuntime,
  type CapabilitySchema,
  type NotificationChannel,
  type NotificationDelivery,
  type PlatformRouteMount,
  type ServiceBinding,
  type ServiceKey,
} from '@candy-mountain/platform-sdk/daemon'

// The platform tables a capability's schema may reference, so a definition and its foreign keys import from one place.
export { agentSessions } from '../db/schema/agent-sessions'
export { chatThreads } from '../db/schema/chat-threads'
export { organisations, workspaces } from '../db/schema/workspaces'

const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')

const emptyServices: BoundServices = Object.freeze({
  get(key: ServiceKey<unknown>): never {
    throw new CapabilityDefinitionError(`Service '${key.name}' is not bound.`)
  },
  has: () => false,
})

/** The services a started definition bound, checked against what it declared; the platform reads offered services from here. */
export function boundServices(definition: CapabilityDefinition, runtime: CapabilityRuntime): BoundServices {
  const declared = new Set((definition.provides ?? []).map(key => key.name))
  const values = new Map<string, unknown>()
  for (const [key, value] of runtime.services ?? []) {
    if (!declared.has(key.name)) throw new CapabilityDefinitionError(`Capability '${definition.id}' binds service '${key.name}' without providing it.`)
    if (values.has(key.name)) throw new CapabilityDefinitionError(`Capability '${definition.id}' binds service '${key.name}' twice.`)
    values.set(key.name, value)
  }
  const missing = [...declared].filter(name => !values.has(name))
  if (missing.length) throw new CapabilityDefinitionError(`Capability '${definition.id}' provides service ${quoted(missing)} but did not bind it.`)
  if (!values.size) return emptyServices
  return {
    get(key) {
      if (!values.has(key.name)) throw new CapabilityDefinitionError(`Capability '${definition.id}' does not bind service '${key.name}'.`)
      return values.get(key.name) as never
    },
    has: key => values.has(key.name),
  }
}

/** What `context.service` resolves for a definition: only keys its declared dependencies bound. */
export function dependencyServices(definition: CapabilityDefinition, servicesByCapability: ReadonlyMap<string, BoundServices>): BoundServices {
  const dependencies = (definition.dependsOn ?? []).map(id => servicesByCapability.get(id) ?? emptyServices)
  return {
    get(key) {
      const owner = dependencies.find(services => services.has(key))
      if (!owner) throw new CapabilityDefinitionError(`Capability '${definition.id}' asked for service '${key.name}', which no declared dependency provides.`)
      return owner.get(key)
    },
    has: key => dependencies.some(services => services.has(key)),
  }
}
