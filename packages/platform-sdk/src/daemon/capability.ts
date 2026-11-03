import type { Hono } from 'hono'
import { FACT_ID_PATTERN, MANIFEST_ID_PATTERN, type AgentSessionFamily, type AnyCapabilityManifest, type NotificationChannelDescription, type NotificationDestination, type NotificationKind, type ScopeLabel, type Workspace } from '../index'
import type { ActivityEventTypeDeclaration } from './activity'
import type { AgentMcpHost, AgentMcpServerDefinition } from './agent-mcp'
import type { AppEnv } from './app'
import type { DataPaths } from './data-paths'
import type { Db, MigrationSchema } from './db'
import type { WorkspaceFactDeclaration, WorkspaceFactRegistry } from './facts'
import type { SessionFamily, SessionFamilyRegistry } from './families'
import { assertCapability, duplicates } from './manifest'
import { assertPluginType, PluginTypeError, type AnyPluginType } from './plugin-types'
import type { CapabilityRegistry, ModuleRegistry, PluginTypeRegistry } from './registries'
import type { SecretsStore } from './secrets'
import type { ServiceBinding, ServiceKey } from './services'
import type { NativeFamilyRunner } from './threads'
import type { WorkspaceAgentSource } from './workspace-agents'

/** Thrown while defining or validating runtime definitions, so a bad definition stops the daemon at boot. */
export class CapabilityDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityDefinitionError'
  }
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
  /** What the notifications page shows; `sender` is null when the channel cannot deliver for this workspace. */
  describe(workspace: Workspace): NotificationChannelDescription
}

/** Applied at boot after the platform's set and the dependencies' sets, under a migrations table named for the capability. */
export interface CapabilitySchema {
  schema: MigrationSchema
  /** Absolute; a drizzle-kit output folder with `meta/_journal.json` inside. */
  migrationsFolder: string
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
  /** Every fact the definition list declares, for a definition that computes the registry itself. */
  workspaceFacts: WorkspaceFactRegistry
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
  /** Mounted under the workspace prefix `/workspaces`, so handlers see `/:slug/...` as they do now. */
  workspaceRoutes?: readonly Hono<AppEnv>[]
  platformRoutes?: readonly PlatformRouteMount[]
  mcpServers?: readonly AgentMcpServerDefinition[]
  /** Families prompted in-process; a family absent here runs through the session service. */
  chatFamilies?: Readonly<Partial<Record<AgentSessionFamily, NativeFamilyRunner>>>
  notificationChannels?: readonly NotificationChannel[]
  /** Agents this capability adds per workspace; the registry lists them and the thread service runs their threads through it. */
  workspaceAgents?: WorkspaceAgentSource
  /** Runs in the deletion's transaction before the platform deletes the workspace row, dependents first; a throw rolls every row back. */
  onWorkspaceDeleted?(workspace: Workspace): void | Promise<void>
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
  schema?: CapabilitySchema
  /** The event types this capability appends, and the notification kinds they raise; registered before boot touches disk. */
  activityEventTypes?: readonly ActivityEventTypeDeclaration[]
  /** The workspace facts this capability answers for the registry, from its own tables; registered before boot touches disk. */
  workspaceFacts?: readonly WorkspaceFactDeclaration[]
  start?(context: CapabilityContext): CapabilityRuntime
}

export function defineCapabilityDefinition(definition: CapabilityDefinition): CapabilityDefinition {
  assertCapabilityDefinition(definition)
  return definition
}

export const isCapabilityDefinition = (entry: AnyCapabilityManifest | CapabilityDefinition): entry is CapabilityDefinition => !('ladder' in entry)

const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')
const isId = (value: unknown): value is string => typeof value === 'string' && MANIFEST_ID_PATTERN.test(value)
const isFactId = (value: unknown): value is string => typeof value === 'string' && FACT_ID_PATTERN.test(value)

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

  if (definition.schema !== undefined) {
    const { schema } = definition
    if (typeof schema !== 'object' || schema === null) fail('schema must declare a schema object and a migrations folder.')
    if (typeof schema.schema !== 'object' || schema.schema === null) fail('schema.schema must be a Drizzle schema object.')
    if (typeof schema.migrationsFolder !== 'string' || schema.migrationsFolder === '') fail('schema.migrationsFolder must be a non-empty path.')
  }

  const facts = definition.workspaceFacts ?? []
  const badFacts = facts.filter(f => !isFactId(f?.id) || typeof f.compute !== 'function' || typeof f.message !== 'function')
  if (badFacts.length) fail(`declares invalid workspace fact(s) ${quoted(badFacts.map(f => String(f?.id)))}; a fact is a camelCase id with compute and message functions.`)
  const dupFacts = duplicates(facts.map(f => f.id))
  if (dupFacts.length) fail(`declares workspace fact ${quoted(dupFacts)} more than once.`)

  if (definition.start !== undefined && typeof definition.start !== 'function') fail('start must be a function.')
}
