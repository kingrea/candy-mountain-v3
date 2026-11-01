import type { Project } from '@candy-mountain/shared'
import type { Hono } from 'hono'
import type { AgentMcpServerDefinition } from '../agent-mcp/host'
import type { AppEnv } from '../app'
import type { NativeFamilyRunners } from '../threads/service'
import { boundServices, CapabilityDefinitionError, dependencyServices, type BoundServices, type CapabilityContext, type CapabilityDefinition, type CapabilityRuntime, type NotificationChannel, type PlatformRouteMount, type ServiceKey } from './definition'
import { orderCapabilityDefinitions } from './registry'

export interface StartedCapability {
  definition: CapabilityDefinition
  runtime: CapabilityRuntime
  services: BoundServices
}

/** The definition list once started: what the app mounts and what platform services consume, plus the reverse-order hooks. */
export interface StartedCapabilities {
  /** Dependencies before dependents. */
  started: readonly StartedCapability[]
  workspaceRoutes: readonly Hono<AppEnv>[]
  platformRoutes: readonly PlatformRouteMount[]
  mcpServers: readonly AgentMcpServerDefinition[]
  chatFamilies: NativeFamilyRunners
  notificationChannels: readonly NotificationChannel[]
  /** The services a capability bound, for platform consumers reading platform-owned keys; throws for an id not in the list. */
  services(id: string): BoundServices
  /** A service by key from whichever capability binds it (the list refuses two), or undefined when none in the list does. */
  service<T>(key: ServiceKey<T>): T | undefined
  /** Dependents first; a throw stops the caller's delete. */
  onWorkspaceDeleted(workspace: Project): Promise<void>
  /** Reverse start order; every runtime is closed even when one throws, and the first error is rethrown. Later calls return the first run. */
  close(): Promise<void>
}

/** Everything but `service`, which the walk builds per definition from its declared dependencies. */
export type CapabilityStartContext = Omit<CapabilityContext, 'service'>

export function startCapabilities(context: CapabilityStartContext): StartedCapabilities {
  const bound = new Map<string, BoundServices>()
  const started: StartedCapability[] = []
  for (const definition of orderCapabilityDefinitions(context.capabilities.definitions())) {
    let runtime: CapabilityRuntime | undefined
    try {
      runtime = definition.start?.({ ...context, service: dependencyServices(definition, bound).get }) ?? {}
      const services = boundServices(definition, runtime)
      bound.set(definition.id, services)
      started.push({ definition, runtime, services })
    }
    catch (error) {
      // What already started would otherwise keep its timers running after a refused boot.
      void closeInReverse(runtime ? [...started, { runtime }] : started).catch(() => undefined)
      throw error
    }
  }

  let closing: Promise<void> | undefined
  const chatFamilies: NativeFamilyRunners = {}
  const mcpNames = new Map<string, string>()
  const channelIds = new Map<string, string>()
  const familyOwners = new Map<string, string>()
  try {
    for (const { definition, runtime } of started) {
      for (const server of runtime.mcpServers ?? []) claim('MCP server', mcpNames, server.name, definition.id, 'offered')
      for (const channel of runtime.notificationChannels ?? []) claim('Notification channel', channelIds, channel.id, definition.id, 'offered')
      for (const [family, runner] of Object.entries(runtime.chatFamilies ?? {})) {
        if (!runner) continue
        if (!context.families.has(family)) throw new CapabilityDefinitionError(`Capability '${definition.id}' runs chat family '${family}', which is not a registered session family.`)
        claim('Chat family', familyOwners, family, definition.id, 'run')
        chatFamilies[family] = runner
      }
    }
  }
  catch (error) {
    void closeInReverse(started).catch(() => undefined)
    throw error
  }

  return {
    started,
    workspaceRoutes: started.flatMap(s => s.runtime.workspaceRoutes ?? []),
    platformRoutes: started.flatMap(s => s.runtime.platformRoutes ?? []),
    mcpServers: started.flatMap(s => s.runtime.mcpServers ?? []),
    chatFamilies,
    notificationChannels: started.flatMap(s => s.runtime.notificationChannels ?? []),
    services(id) {
      const services = bound.get(id)
      if (!services) throw new CapabilityDefinitionError(`Capability '${id}' is not in the definition list.`)
      return services
    },
    service(key) {
      const owner = [...bound.values()].find(services => services.has(key))
      return owner?.get(key)
    },
    async onWorkspaceDeleted(workspace) {
      for (const { runtime } of [...started].reverse()) await runtime.onWorkspaceDeleted?.(workspace)
    },
    close: () => (closing ??= closeInReverse(started)),
  }
}

function claim(what: string, owners: Map<string, string>, key: string, owner: string, verb: string): void {
  const other = owners.get(key)
  if (other) throw new CapabilityDefinitionError(`${what} '${key}' is ${verb} by both capability '${other}' and capability '${owner}'.`)
  owners.set(key, owner)
}

async function closeInReverse(started: readonly Pick<StartedCapability, 'runtime'>[]): Promise<void> {
  let failure: unknown
  let failed = false
  for (const { runtime } of [...started].reverse()) {
    try {
      await runtime.close?.()
    }
    catch (error) {
      if (!failed) {
        failed = true
        failure = error
      }
    }
  }
  if (failed) throw failure
}
