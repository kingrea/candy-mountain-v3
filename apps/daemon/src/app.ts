import { Hono } from 'hono'
import { ACTIVITY_PATH, AUTH_PATH, CAPABILITY_CATALOG_PATH, GRANTS_PATH, HEALTH_PATH, INFO_PATH, LIVE_VERSION_SOURCES_PATH, MODULES_PATH, MONITOR_SOURCES_PATH, ORGANISATIONS_PATH, PLATFORM_SETTINGS_PATH, PLUGIN_TYPES_PATH, PLUGINS_PATH, PROJECTS_PATH, type Actor, type AuthStrategyName, type HealthResponse } from '@candy-mountain/shared'
import { activityRoutes, allActivityRoutes } from './activity'
import { authMiddleware, authRoutes, developmentStrategy, type AuthStrategy } from './auth'
import { botSessionRoutes, type BotSessionService } from './bot-sessions'
import { botRoutes } from './bots'
import { CAPABILITIES, capabilityRoutes, createCapabilityRegistry, type CapabilityRegistry } from './capabilities'
import type { DataPaths } from './data-dir'
import type { Db } from './db'
import { grantRoutes } from './grants'
import { issueEventRoutes, issueRoutes, issueWriteRoutes, type IssueWatcher } from './issues'
import { createModuleRegistry, moduleRoutes, MODULES, type ModuleRegistry } from './modules'
import { notificationRoutes } from './notifications'
import { createPluginTypeRegistry, PLUGIN_TYPES, type PluginTypeRegistry } from './plugins'
import { pluginInstanceRoutes, pluginTypeRoutes, type SecretsReader } from './plugins/instances'
import { assigneeRoutes } from './assignees'
import { projectModuleRoutes } from './project-modules'
import { registryRoutes } from './registry'
import { organisationRoutes, projectRoutes } from './projects'
import { infoRoutes } from './routes/info'
import { lockedSecretsStore, type SecretsWriter } from './secrets'
import { decisionRoutes, type DecisionService } from './decisions'
import { environmentRoutes, liveVersionSourceRoutes } from './environments'
import { platformSettingsRoutes } from './settings'
import { sessionRoutes, type SessionManager } from './sessions'
import { slackRoutes, type SlackConnections } from './slack'
import { teamRoutes } from './team'
import { threadRoutes, threadServiceFor, type NativeFamilyRunners } from './threads'
import { monitorRoutes, monitorSourceRoutes } from './uptime'

export interface AppDeps {
  db: Db
  paths: DataPaths
  auth?: AuthStrategy
  capabilities?: CapabilityRegistry
  modules?: ModuleRegistry
  issueWatcher?: IssueWatcher
  secrets?: SecretsWriter
  /** The full store, for plugin health checks and actions; handed to route factories, never put in `c.var`. */
  secretsReader?: SecretsReader
  pluginTypes?: PluginTypeRegistry
  sessions?: SessionManager
  decisions?: DecisionService
  slack?: SlackConnections
  botSessions?: BotSessionService
  /** Chat families the daemon runs in-process (the platform agent); absent families go through the ACP harness. */
  nativeFamilies?: NativeFamilyRunners
}

export interface AppVariables {
  db: Db
  paths: DataPaths
  authStrategy: AuthStrategyName
  capabilities: CapabilityRegistry
  modules: ModuleRegistry
  pluginTypes: PluginTypeRegistry
  secrets: SecretsWriter
  /** Set by the auth middleware on every non-public route; public routes must not read it. */
  actor: Actor
}

export interface AppEnv {
  Variables: AppVariables
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const auth = deps.auth ?? developmentStrategy()
  const capabilities = deps.capabilities ?? createCapabilityRegistry(CAPABILITIES)
  const modules = deps.modules ?? createModuleRegistry(MODULES, capabilities)
  const pluginTypes = deps.pluginTypes ?? createPluginTypeRegistry(PLUGIN_TYPES)
  const locked = lockedSecretsStore()
  const secrets = deps.secrets ?? locked.writeOnly

  app.use(async (c, next) => {
    c.set('db', deps.db)
    c.set('paths', deps.paths)
    c.set('authStrategy', auth.name)
    c.set('capabilities', capabilities)
    c.set('modules', modules)
    c.set('pluginTypes', pluginTypes)
    c.set('secrets', secrets)
    await next()
  })
  app.use(authMiddleware(auth))

  app.get(HEALTH_PATH, c => c.json<HealthResponse>({ status: 'ok' }))
  app.route(INFO_PATH, infoRoutes())
  app.route(AUTH_PATH, authRoutes(auth))
  app.route(PROJECTS_PATH, projectRoutes(deps.secretsReader ?? locked))
  if (deps.issueWatcher) app.route(PROJECTS_PATH, issueEventRoutes(deps.issueWatcher))
  app.route(PROJECTS_PATH, issueRoutes())
  app.route(PROJECTS_PATH, issueWriteRoutes())
  app.route(PROJECTS_PATH, projectModuleRoutes())
  app.route(PROJECTS_PATH, assigneeRoutes())
  app.route(PROJECTS_PATH, registryRoutes())
  app.route(PROJECTS_PATH, activityRoutes())
  app.route(ACTIVITY_PATH, allActivityRoutes())
  app.route(PROJECTS_PATH, botRoutes(deps.secretsReader ?? locked))
  if (deps.botSessions) app.route(PROJECTS_PATH, botSessionRoutes(deps.botSessions))
  if (deps.slack) app.route(PROJECTS_PATH, slackRoutes(deps.slack))
  app.route(PROJECTS_PATH, notificationRoutes())
  app.route(PROJECTS_PATH, teamRoutes())
  app.route(PROJECTS_PATH, monitorRoutes())
  app.route(PROJECTS_PATH, environmentRoutes(deps.secretsReader ?? locked))
  if (deps.sessions) {
    app.route(PROJECTS_PATH, sessionRoutes(deps.sessions))
    if (deps.decisions) app.route(PROJECTS_PATH, decisionRoutes(deps.sessions, deps.decisions))
    app.route(PROJECTS_PATH, threadRoutes(threadServiceFor(deps.db, deps.sessions, { native: deps.nativeFamilies, bots: deps.botSessions })))
  }
  app.route(ORGANISATIONS_PATH, organisationRoutes())
  app.route(GRANTS_PATH, grantRoutes())
  app.route(MODULES_PATH, moduleRoutes())
  app.route(CAPABILITY_CATALOG_PATH, capabilityRoutes())
  app.route(PLUGIN_TYPES_PATH, pluginTypeRoutes())
  app.route(MONITOR_SOURCES_PATH, monitorSourceRoutes())
  app.route(LIVE_VERSION_SOURCES_PATH, liveVersionSourceRoutes())
  app.route(PLUGINS_PATH, pluginInstanceRoutes(deps.secretsReader ?? locked))
  if (deps.secrets) app.route(PLATFORM_SETTINGS_PATH, platformSettingsRoutes(deps.secrets))

  return app
}
