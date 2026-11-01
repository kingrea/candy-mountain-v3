import { ACTIVITY_EVENT_TYPES, createActivityEventTypeRegistry, registerActivityEventTypes, type ActivityEventTypeRegistry } from './activity'
import { startAgentMcpHost, type AgentMcpHost } from './agent-mcp'
import { seedAuth } from './auth/seed'
import { createCapabilityRegistry, startCapabilities, type CapabilityRegistry, type StartedCapabilities } from './capabilities'
import { ensureDataDir, type DataPaths } from './data-dir'
import { openDatabase, type Db, type OpenDatabaseOptions } from './db'
import { seedAdminGrants } from './grants/seed'
import { createModuleRegistry, type ModuleRegistry } from './modules/registry'
import { startNotificationDispatcher, type NotificationDispatcher, type NotificationDispatcherOptions } from './notifications'
import { platformDefinitions } from './platform-capabilities'
import { createPluginTypeRegistry, type PluginTypeRegistry } from './plugins/registry'
import { assertProduct, type Product } from './product'
import { createSecretsStore, type MasterKey, type SecretsStore } from './secrets'
import { assertAgentFamilies, createSessionFamilyRegistry, SESSION_FAMILIES, type SessionFamily, type SessionFamilyRegistry } from './threads/families'

export interface Platform {
  product: Product
  paths: DataPaths
  db: Db
  appliedMigrations: number
  secrets: SecretsStore
  capabilities: CapabilityRegistry
  /** The started definition list; the app mounts its routes and runs its chat families. */
  runtime: StartedCapabilities
  modules: ModuleRegistry
  pluginTypes: PluginTypeRegistry
  families: SessionFamilyRegistry
  activityEventTypes: ActivityEventTypeRegistry
  agentMcp: AgentMcpHost
  notifications: NotificationDispatcher
  /** Resolves once the started definitions have closed and the database is shut. */
  close(): Promise<void>
}

export interface PlatformOptions extends OpenDatabaseOptions {
  secretsKey?: MasterKey
  /** What to boot: the platform has no capabilities, modules or plugin types of its own beyond its platform definitions. */
  product: Product
  families?: readonly SessionFamily[]
  activityEventTypes?: readonly string[]
  notifications?: NotificationDispatcherOptions
}

export function startPlatform(dataDir: string, { secretsKey, product, families = SESSION_FAMILIES, activityEventTypes = ACTIVITY_EVENT_TYPES, notifications: notificationOptions, ...options }: PlatformOptions): Platform {
  // Validated before anything touches disk, so a bad manifest, plugin type or family leaves no trace; the product's own come first so their errors do too.
  assertProduct(product)
  const { capabilities, modules, pluginTypes } = product
  const productPluginTypes = createPluginTypeRegistry(pluginTypes)
  const productFamilies = createSessionFamilyRegistry(families)
  const registry = createCapabilityRegistry([...platformDefinitions(), ...capabilities], { pluginTypeIds: productPluginTypes.ids(), familyIds: productFamilies.ids() })
  const definitions = registry.definitions()
  const pluginTypeRegistry = createPluginTypeRegistry([...pluginTypes, ...definitions.flatMap(d => d.pluginTypes ?? [])])
  const moduleRegistry = createModuleRegistry(modules, registry)
  // Definition families first keeps the order of the old fixed family list, which session listings and their first refusal follow.
  const familyRegistry = createSessionFamilyRegistry([...definitions.flatMap(d => d.sessionFamilies ?? []), ...families])
  assertAgentFamilies(registry.list(), familyRegistry)
  const activityTypes = createActivityEventTypeRegistry(activityEventTypes)
  const paths = ensureDataDir(dataDir)
  const database = openDatabase(paths.database, options)
  registerActivityEventTypes(database.db, activityTypes)
  seedAuth(database.db)
  seedAdminGrants({ db: database.db, capabilities: registry, modules: moduleRegistry })
  const secrets = createSecretsStore(paths.secrets, secretsKey)
  // Definitions start before the host that serves their MCP servers, so they get a facade that resolves once it exists.
  const runtime = startCapabilities({ db: database.db, paths, secrets, capabilities: registry, modules: moduleRegistry, pluginTypes: pluginTypeRegistry, families: familyRegistry, agentMcp: { serversFor: session => agentMcp.serversFor(session) }, scopeUrlPrefix: product.config.scope.urlPrefix, scopeLabel: product.config.scope.label })
  const agentMcp = startAgentMcpHost({ db: database.db, servers: runtime.mcpServers })
  const notifications = startNotificationDispatcher({ db: database.db, channels: runtime.notificationChannels, scopeUrlPrefix: product.config.scope.urlPrefix }, notificationOptions)
  const close = async () => {
    notifications.close()
    void agentMcp.close()
    try {
      // Definitions still write while they close (a session's last rows), so the database outlives them.
      await runtime.close()
    }
    finally {
      database.close()
    }
  }
  return { product, paths, db: database.db, appliedMigrations: database.appliedMigrations, secrets, capabilities: registry, runtime, modules: moduleRegistry, pluginTypes: pluginTypeRegistry, families: familyRegistry, activityEventTypes: activityTypes, agentMcp, notifications, close }
}
