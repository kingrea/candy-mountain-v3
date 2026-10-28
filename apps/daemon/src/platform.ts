import { join } from 'node:path'
import type { AnyCapabilityManifest, ModuleDefinition } from '@candy-mountain/shared'
import { createAcpHarness, type AcpHarness, type AcpHarnessOptions } from './acp'
import { startAgentMcpHost, type AgentMcpHost } from './agent-mcp'
import { seedAuth } from './auth/seed'
import { createBotSessionService, type BotSessionService } from './bot-sessions'
import { CAPABILITIES, createCapabilityRegistry, type CapabilityRegistry } from './capabilities'
import { ensureDataDir, type DataPaths } from './data-dir'
import { openDatabase, type Db, type OpenDatabaseOptions } from './db'
import { seedAdminGrants } from './grants/seed'
import { startIssueWatcher, type IssueWatcher } from './issues'
import { createModuleRegistry, MODULES, type ModuleRegistry } from './modules'
import { startNotificationDispatcher, type NotificationDispatcher, type NotificationDispatcherOptions } from './notifications'
import { claudeLoginAttempts, codexLoginAttempts, createPluginTypeRegistry, PLUGIN_TYPES, type AnyPluginType, type PluginTypeRegistry } from './plugins'
import { createSecretsStore, type MasterKey, type SecretsStore } from './secrets'
import { createDecisionService, type DecisionService, type DecisionServiceOptions } from './decisions'
import { createSessionManager, type SessionManager, type SessionManagerOptions } from './sessions'
import { slackMcpServer, startSlackConnections, startSlackDecisions, startSlackHandoffs, startSlackRouter, type SlackConnections, type SlackConnectionsOptions, type SlackDecisions, type SlackDecisionsOptions, type SlackHandoffs, type SlackHandoffsOptions, type SlackRouter, type SlackRouterOptions, type SlackTurnEnd } from './slack'
import { startIncidentTracker, startUptimeScheduler, type IncidentTracker, type UptimeScheduler, type UptimeSchedulerOptions } from './uptime'
import { createWorktreePool, startWorktreeReclaimer, type WorktreePool, type WorktreePoolOptions, type WorktreeReclaimer, type WorktreeReclaimerOptions } from './worktrees'

export interface Platform {
  paths: DataPaths
  db: Db
  appliedMigrations: number
  secrets: SecretsStore
  capabilities: CapabilityRegistry
  modules: ModuleRegistry
  pluginTypes: PluginTypeRegistry
  issueWatcher: IssueWatcher
  acpHarness: AcpHarness
  sessions: SessionManager
  decisions: DecisionService
  worktrees: WorktreePool
  worktreeReclaimer: WorktreeReclaimer
  botSessions: BotSessionService
  slack: SlackConnections
  slackRouter: SlackRouter
  slackDecisions: SlackDecisions
  slackHandoffs: SlackHandoffs
  agentMcp: AgentMcpHost
  notifications: NotificationDispatcher
  uptimeScheduler: UptimeScheduler
  uptimeIncidents: IncidentTracker
  close(): void
}

export interface PlatformOptions extends OpenDatabaseOptions {
  secretsKey?: MasterKey
  capabilities?: readonly AnyCapabilityManifest[]
  modules?: readonly ModuleDefinition[]
  pluginTypes?: readonly AnyPluginType[]
  acp?: AcpHarnessOptions
  sessions?: SessionManagerOptions
  decisions?: DecisionServiceOptions
  worktrees?: WorktreePoolOptions & WorktreeReclaimerOptions
  slack?: SlackConnectionsOptions
  slackRouter?: SlackRouterOptions
  slackDecisions?: SlackDecisionsOptions
  slackHandoffs?: SlackHandoffsOptions
  /** Outbound fetch and Slack connections for the daemon-hosted MCP tools; test seams. */
  agentMcp?: { fetch?: typeof fetch, slack?: Pick<SlackConnections, 'web'> }
  notifications?: NotificationDispatcherOptions
  uptime?: UptimeSchedulerOptions
}

export function startPlatform(dataDir: string, { secretsKey, capabilities = CAPABILITIES, modules = MODULES, pluginTypes = PLUGIN_TYPES, acp, sessions: sessionOptions, decisions: decisionOptions, worktrees: worktreeOptions, slack: slackOptions, slackRouter: slackRouterOptions, slackDecisions: slackDecisionsOptions, slackHandoffs: slackHandoffsOptions, agentMcp: agentMcpOptions, notifications: notificationOptions, uptime: uptimeOptions, ...options }: PlatformOptions = {}): Platform {
  // Validated before anything touches disk, so a bad manifest or plugin type leaves no trace.
  const pluginTypeRegistry = createPluginTypeRegistry(pluginTypes)
  const registry = createCapabilityRegistry(capabilities, { pluginTypeIds: pluginTypeRegistry.ids() })
  const moduleRegistry = createModuleRegistry(modules, registry)
  const paths = ensureDataDir(dataDir)
  const database = openDatabase(paths.database, options)
  seedAuth(database.db)
  seedAdminGrants({ db: database.db, capabilities: registry, modules: moduleRegistry })
  const secrets = createSecretsStore(paths.secrets, secretsKey)
  const issueWatcher = startIssueWatcher({ db: database.db })
  const acpHarness = createAcpHarness(acp)
  const sessions = createSessionManager({ db: database.db, paths, pluginTypes: pluginTypeRegistry, secrets: secrets.writeOnly, secretsReader: secrets, harness: acpHarness, mcpServers: session => agentMcp.serversFor(session) }, sessionOptions)
  const decisions = createDecisionService({ db: database.db, sessions }, decisionOptions)
  const worktrees = createWorktreePool({ db: database.db, paths }, worktreeOptions)
  const worktreeReclaimer = startWorktreeReclaimer({ db: database.db, paths, pool: worktrees }, worktreeOptions)
  const botSessions = createBotSessionService({ db: database.db, paths, pluginTypes: pluginTypeRegistry, secrets: secrets.writeOnly, secretsReader: secrets, sessions, worktrees })
  const slack = startSlackConnections({ db: database.db, pluginTypes: pluginTypeRegistry, secrets: secrets.writeOnly, secretsReader: secrets }, slackOptions)
  const agentMcp = startAgentMcpHost({ db: database.db, servers: [slackMcpServer({ db: database.db, slack: agentMcpOptions?.slack ?? slack }, { fetch: agentMcpOptions?.fetch })] })
  const slackDecisions = startSlackDecisions({ db: database.db, slack, decisions, sessions }, slackDecisionsOptions)
  const slackHandoffs = startSlackHandoffs({ db: database.db, slack, botSessions, sessions }, slackHandoffsOptions)
  const onTurnEnd = async (end: SlackTurnEnd) => {
    await slackHandoffs.onTurnEnd(end)
    await slackRouterOptions?.onTurnEnd?.(end)
  }
  const slackRouter = startSlackRouter({ db: database.db, slack, botSessions, sessions, interceptReply: slackDecisions.interceptReply }, { ...slackRouterOptions, onTurnEnd })
  const notifications = startNotificationDispatcher({ db: database.db, pluginTypes: pluginTypeRegistry, secrets: secrets.writeOnly, secretsReader: secrets, slack }, notificationOptions)
  const uptimeScheduler = startUptimeScheduler({ db: database.db, key: paths.root, ownerFile: join(paths.run, 'uptime-scheduler.owner') }, uptimeOptions)
  const uptimeIncidents = startIncidentTracker({ db: database.db, scheduler: uptimeScheduler })
  const close = () => {
    uptimeIncidents.close()
    uptimeScheduler.close()
    notifications.close()
    slackRouter.close()
    slackDecisions.close()
    slackHandoffs.close()
    void slack.close()
    decisions.close()
    botSessions.stop()
    void agentMcp.close()
    void sessions.close()
    void acpHarness.close()
    void codexLoginAttempts.close()
    claudeLoginAttempts.close()
    issueWatcher.close()
    worktreeReclaimer.close()
    database.close()
  }
  return { paths, db: database.db, appliedMigrations: database.appliedMigrations, secrets, capabilities: registry, modules: moduleRegistry, pluginTypes: pluginTypeRegistry, issueWatcher, acpHarness, sessions, decisions, worktrees, worktreeReclaimer, botSessions, slack, slackRouter, slackDecisions, slackHandoffs, agentMcp, notifications, uptimeScheduler, uptimeIncidents, close }
}
