// What a distribution boots with.
export { startPlatform, type Platform, type PlatformOptions } from './platform'
export { createApp, type AppDeps, type AppEnv, type AppVariables } from './app'
export { assertProduct, productCapabilityRegistry, ProductError, suppliedIds, type Product } from './product'
export { platformDefinitions } from './platform-capabilities'
export { ADMIN_PASSWORD_ENV, applyAdminPassword, createAuthStrategy, developmentStrategy, requireAdminPassword, resolveAuthConfig, type AuthConfig, type AuthStrategy } from './auth'
export { MasterKey, SECRETS_KEY_ENV } from './secrets'
export { resolveNotificationSettings, type NotificationSettings } from './notifications/config'
export type { NotificationDispatcherOptions } from './notifications/dispatcher'
export { dataPaths, ensureDataDir, type DataPaths } from './data-dir'
export { assertMigrationSets, LEGACY_MIGRATIONS_DIR, LEGACY_MIGRATIONS_TABLE, LegacyHistoryError, MIGRATIONS_DIR, migrationsTableFor, MigrationSetError, openDatabase, PLATFORM_MIGRATION_SET, PLATFORM_MIGRATION_SET_ID, type AppliedMigrationSet, type Db, type LegacyCarryOver, type MigrationSet, type PlatformDatabase } from './db'
export { migrationSets } from './capabilities/migration-sets'

// Definitions and registries a product composes from.
export { boundServices, CapabilityDefinitionError, dependencyServices, isCapabilityDefinition, type CapabilityDefinition, type NotificationChannel, type NotificationDelivery } from './capabilities/definition'
export { createCapabilityRegistry, type CapabilityRegistry, type CapabilityRegistryEntry } from './capabilities/registry'
export { startCapabilities, type StartedCapabilities, type StartedCapability } from './capabilities/start'
export { duplicates } from './capabilities/manifest'
export { createModuleRegistry, ModuleDefinitionError, type ModuleRegistry } from './modules/registry'
export { createPluginTypeRegistry, type PluginTypeRegistry } from './plugins/registry'
export { definePluginType, type AnyPluginType, type PluginHealthContext, type PluginType } from './plugins/definition'
export { PluginActionError } from './plugins/actions'
export { createSessionFamilyRegistry, SESSION_FAMILIES, SessionFamilyError, type SessionFamily, type SessionFamilyRegistry } from './threads/families'
export { createActivityEventTypeRegistry, declaredActivityEventTypes, registerActivityEventTypes, type ActivityEventTypeRegistry } from './activity/types'
export { createWorkspaceFactRegistry, declaredWorkspaceFacts, type WorkspaceFactRegistry } from './registry/facts'
export { overviewDefinition } from './overview/definition'
export { threadsDefinition, THREADS_CAPABILITY_ID, type ThreadsOptions } from './threads/definition'
export { PLATFORM_AGENT, PLATFORM_FAMILY, platformAgentDefinition, type PlatformAgentService } from './platform-agent/definition'
export type { PlatformAgentOptions } from './platform-agent/runner'
export { platformAgentCapability } from './platform-agent/manifest'
export { describePlatform, openView, startChat } from './platform-agent/tools'
export type { PlatformTurnContext } from './platform-agent/context'

// Route helpers and gates.
export { requireAdmin } from './auth/admin'
export { gateChat, gateTool, gateView, requireCapability, resolveCapabilityAccess, type GateRefusal, type GateResult } from './registry/gate'
export { loadRegistry, type RegistryDeps } from './registry/load'
export { resolveActorRungs } from './grants/resolve'

// Actor and workspace lookups.
export { findActorById, findActorByUsername } from './auth/actors'
export { archiveWorkspace, createWorkspace, deleteWorkspace, findWorkspaceById, findWorkspaceBySlug, getWorkspaceBySlug, listWorkspaces, onWorkspaceArchiveChange, unarchiveWorkspace, WorkspaceError } from './workspaces'
export { setGrant } from './grants/grants'
export { setEnabledModules } from './workspace-modules/enablement'

// Plugin instances and secrets.
export { createPluginInstance, deletePluginInstance, resolvePluginInstance, testPluginInstance, updatePluginInstance, type PluginInstanceDeps, type SecretsReader } from './plugins/instances/instances'
export { checkPluginHealth } from './plugins/health'
export { createPluginSecrets } from './plugins/secrets'
export { createSecretsStore, lockedSecretsStore, SecretsLockedError, type SecretsStore, type SecretsWriter } from './secrets'

// Activity.
export { ActivityError } from './activity/errors'
export { appendActivityEvent, listActivityEvents, type AppendActivityEventInput } from './activity/events'

// Notifications.
export { absoluteLink, startNotificationDispatcher, type NotificationDispatcher } from './notifications/dispatcher'
export { claimNotificationEvent, DELIVERED_RING_SIZE, notificationDeliveredKey, notificationRulesKey, readNotificationRules } from './notifications/rules'

// Threads, sessions and the platform service keys.
export { THREAD_SESSIONS, type CreateSessionInput, type NativeTurn, type NativeTurnRunner, type SessionListener, type SessionMessage, type SessionObserver, type SessionStore, type ThreadSessions } from './threads/sessions'
export { findThread, insertThread, switchThreadSession } from './threads/store'
export { listSessionEvents } from './threads/session-store'
export { SessionError } from './threads/session-errors'
export { parsePrompt } from './threads/prompt'
export { familyCapability, threadTitle } from './threads/service'
export { WorkspaceAgentError, type WorkspaceAgentListing, type WorkspaceAgentSource } from './threads/agents'

// The agent MCP host.
export { startAgentMcpHost, type AgentMcpHost, type AgentMcpServerDefinition, type LaunchMcpServer } from './agent-mcp/host'
export { claudeMcpToolRule, SLACK_POST_BLOCKS_TOOL, WRAPPED_MCP_TOOL_RULES, WRAPPED_MCP_TOOLS, type WrappedMcpTool } from './agent-mcp/tools'

// The platform schema set's tables, for a capability's foreign keys and the platform-owned rows it reads.
export { activityEvents, agentSessionEvents, agentSessions, authSessions, chatThreads, chatThreadSessions, organisations, platformMeta, pluginInstances, roleGrants, roles, userPasswords, userRoles, users, workspaceModules, workspaces } from './db/schema'

// Test support: a platform booted from explicit definitions, never a product's.
export { createTempDataDir, createTestApp, openTestDatabase, platformApp, startTestPlatform, TEST_PRODUCT_CONFIG, testProduct, type ProductParts, type TempDataDir, type TestAppDeps, type TestPlatformOptions } from './testing'
export { cloneManifest, fixtureCapability, fixtureCapabilityContext, fixtureDefinition, undescribed } from './capabilities/fixtures'
export { clonePluginType, fixturePluginType, globalPluginType } from './plugins/fixtures'
export { instanceHarness, multiPluginType, type InstanceHarness, type InstanceHarnessOptions } from './plugins/instances/test-support'
export { addRole, testAccess, TEST_CAPABILITIES, TEST_MODULES } from './grants/test-access'
export { migrationsBefore, schemaShape } from './db/test-support'
export { scriptedReply, startStubGateway, type StubGateway, type StubGatewayReply, type StubGatewayRequest } from './platform-agent/test-support'
