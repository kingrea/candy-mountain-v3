import { MANIFEST_ID_PATTERN, type AgentSessionFamily, type AnyCapabilityManifest, type NotificationDestination, type NotificationKind, type Project, type ScopeLabel } from '@candy-mountain/shared'
import type { Hono } from 'hono'
import type { AgentMcpHost, AgentMcpServerDefinition } from '../agent-mcp/host'
import type { AppEnv } from '../app'
import type { DataPaths } from '../data-dir'
import type { Db } from '../db'
import type { ModuleRegistry } from '../modules/registry'
import { assertPluginType, PluginTypeError, type AnyPluginType } from '../plugins/definition'
import type { PluginTypeRegistry } from '../plugins/registry'
import type { SecretsStore } from '../secrets/store'
import type { SessionFamily, SessionFamilyRegistry } from '../threads/families'
import type { NativeFamilyRunner } from '../threads/service'
import { assertCapability, duplicates } from './manifest'
import type { CapabilityRegistry } from './registry'

/** Thrown while defining or validating runtime definitions, so a bad definition stops the daemon at boot. */
export class CapabilityDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityDefinitionError'
  }
}

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

export interface PlatformRouteMount {
  /** Absolute, e.g. '/monitor-sources'. */
  path: string
  routes: Hono<AppEnv>
}

export interface NotificationDelivery {
  workspaceId: string
  kind: NotificationKind
  destination: NotificationDestination
  title: string
  /** Absolute link to open in the web app. */
  url: string
}

/** A way the notification dispatcher can deliver; the dispatcher tries channels in list order. */
export interface NotificationChannel {
  id: string
  /** False when the channel has no identity for that workspace, so the dispatcher moves on; a throw is a failed delivery. */
  deliver(delivery: NotificationDelivery, signal: AbortSignal): Promise<boolean>
}

/** What a definition's start may use; `service` resolves only keys bound by a declared dependency. */
export interface CapabilityContext {
  db: Db
  paths: DataPaths
  secrets: SecretsStore
  capabilities: CapabilityRegistry
  modules: ModuleRegistry
  pluginTypes: PluginTypeRegistry
  families: SessionFamilyRegistry
  agentMcp: Pick<AgentMcpHost, 'serversFor'>
  /** The product's `scope.urlPrefix`, for links into the web app. */
  scopeUrlPrefix: string
  /** The product's `scope.label`, for daemon-written text that names a workspace. */
  scopeLabel: ScopeLabel
  service<T>(key: ServiceKey<T>): T
}

/** Everything a started definition hands the daemon; every field is optional so a manifest-only definition starts to nothing. */
export interface CapabilityRuntime {
  /** Must bind exactly the keys the definition `provides`. */
  services?: readonly ServiceBinding[]
  /** Mounted under the workspace prefix (today `/projects`), so handlers see `/:slug/...` as they do now. */
  workspaceRoutes?: readonly Hono<AppEnv>[]
  platformRoutes?: readonly PlatformRouteMount[]
  mcpServers?: readonly AgentMcpServerDefinition[]
  /** Families prompted in-process; a family absent here runs through the session service. */
  chatFamilies?: Readonly<Partial<Record<AgentSessionFamily, NativeFamilyRunner>>>
  notificationChannels?: readonly NotificationChannel[]
  /** Runs before the platform deletes the workspace row, dependents first; a throw stops the delete. */
  onWorkspaceDeleted?(workspace: Project): void | Promise<void>
  /** Called in reverse start order. */
  close?(): void | Promise<void>
}

export interface CapabilityDefinition {
  /** Equals `manifest.id` when there is a manifest. */
  id: string
  /** Absent for a service-only definition, which is then in no catalog, module or grant. */
  manifest?: AnyCapabilityManifest
  dependsOn?: readonly string[]
  pluginTypes?: readonly AnyPluginType[]
  /** Registered before boot touches disk, so manifest agents may name them; the sessions themselves run through a service. */
  sessionFamilies?: readonly SessionFamily[]
  /** Keys `start` binds for dependents and platform services. */
  provides?: readonly ServiceKey<unknown>[]
  start?(context: CapabilityContext): CapabilityRuntime
}

export function defineCapabilityDefinition(definition: CapabilityDefinition): CapabilityDefinition {
  assertCapabilityDefinition(definition)
  return definition
}

export const isCapabilityDefinition = (entry: AnyCapabilityManifest | CapabilityDefinition): entry is CapabilityDefinition => !('ladder' in entry)

const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')
const isId = (value: unknown): value is string => typeof value === 'string' && MANIFEST_ID_PATTERN.test(value)

export function assertCapabilityDefinition(definition: CapabilityDefinition): void {
  const fail = (msg: string): never => {
    throw new CapabilityDefinitionError(`Capability '${String(definition.id)}': ${msg}`)
  }
  if (!isId(definition.id)) throw new CapabilityDefinitionError(`Invalid capability id '${String(definition.id)}'; ids are lowercase letters and digits joined by '-', '_' or '.'.`)

  if (definition.manifest !== undefined) {
    if (typeof definition.manifest !== 'object' || definition.manifest === null) fail('manifest must be a capability manifest.')
    assertCapability(definition.manifest)
    if (definition.manifest.id !== definition.id) fail(`manifest id '${definition.manifest.id}' does not match.`)
  }

  const dependsOn = definition.dependsOn ?? []
  const badDeps = dependsOn.filter(id => !isId(id))
  if (badDeps.length) fail(`invalid dependency id(s) ${quoted(badDeps.map(String))}.`)
  if (dependsOn.includes(definition.id)) fail('depends on itself.')
  if (duplicates(dependsOn).length) fail(`repeats dependency ${quoted(duplicates(dependsOn))}.`)

  for (const type of definition.pluginTypes ?? []) {
    try {
      assertPluginType(type)
    }
    catch (error) {
      if (error instanceof PluginTypeError) fail(error.message)
      throw error
    }
  }
  const dupTypes = duplicates((definition.pluginTypes ?? []).map(t => t.id))
  if (dupTypes.length) fail(`brings plugin type ${quoted(dupTypes)} more than once.`)

  const families = definition.sessionFamilies ?? []
  const badFamilies = families.filter(f => !isId(f?.id) || typeof f.name !== 'string' || f.name.trim() === '')
  if (badFamilies.length) fail(`registers invalid session family(ies) ${quoted(badFamilies.map(f => String(f?.id)))}; a family is an id matching the manifest id pattern with a non-empty name.`)
  const dupFamilies = duplicates(families.map(f => f.id))
  if (dupFamilies.length) fail(`registers session family ${quoted(dupFamilies)} more than once.`)

  const provided = (definition.provides ?? []).map(key => key?.name)
  const badKeys = provided.filter(name => !isId(name))
  if (badKeys.length) fail(`provides invalid service key(s) ${quoted(badKeys.map(String))}.`)
  if (duplicates(provided).length) fail(`provides service ${quoted(duplicates(provided))} more than once.`)

  if (definition.start !== undefined && typeof definition.start !== 'function') fail('start must be a function.')
}

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
