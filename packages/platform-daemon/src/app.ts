import { Hono } from 'hono'
import { ACTIVITY_PATH, AUTH_PATH, CAPABILITY_CATALOG_PATH, GRANTS_PATH, HEALTH_PATH, INFO_PATH, MODULES_PATH, ORGANISATIONS_PATH, PLATFORM_SETTINGS_PATH, PLUGIN_TYPES_PATH, PLUGINS_PATH, WORKSPACES_PATH, type HealthResponse } from '@candy-mountain/platform-sdk'
import type { AppEnv } from '@candy-mountain/platform-sdk/daemon'
import { activityRoutes, allActivityRoutes } from './activity'
import { authMiddleware, authRoutes, developmentStrategy, type AuthStrategy } from './auth'
import { capabilityRoutes, type CapabilityRegistry, type StartedCapabilities } from './capabilities'
import type { DataPaths } from './data-dir'
import type { Db } from './db'
import { grantRoutes } from './grants'
import { createModuleRegistry, type ModuleRegistry } from './modules/registry'
import { moduleRoutes } from './modules/routes'
import { notificationRoutes } from './notifications'
import { createPluginTypeRegistry, type PluginTypeRegistry } from './plugins/registry'
import { pluginInstanceRoutes, pluginTypeRoutes, type SecretsReader } from './plugins/instances'
import { productCapabilityRegistry, type Product } from './product'
import { workspaceModuleRoutes } from './workspace-modules'
import { registryRoutes } from './registry'
import { createWorkspaceFactRegistry, declaredWorkspaceFacts, type WorkspaceFactRegistry } from './registry/facts'
import { organisationRoutes, workspaceRoutes } from './workspaces'
import { infoRoutes } from './routes/info'
import { lockedSecretsStore, type SecretsWriter } from './secrets'
import { platformSettingsRoutes } from './settings'
import { createSessionFamilyRegistry, createWorkspaceAgentRegistry, SESSION_FAMILIES, THREAD_SESSIONS, threadRoutes, threadServiceFor, type SessionFamilyRegistry } from './threads'

export type { AppEnv, AppVariables } from '@candy-mountain/platform-sdk/daemon'

export interface AppDeps {
  db: Db
  paths: DataPaths
  auth?: AuthStrategy
  /** Registries not passed are built from it; the info route reports its name and scope label. */
  product: Product
  capabilities?: CapabilityRegistry
  modules?: ModuleRegistry
  secrets?: SecretsWriter
  /** The full store, for plugin health checks and actions; handed to route factories, never put in `c.var`. */
  secretsReader?: SecretsReader
  pluginTypes?: PluginTypeRegistry
  families?: SessionFamilyRegistry
  /** Built from the capability registry's definitions when not passed. */
  workspaceFacts?: WorkspaceFactRegistry
  /** The started definition list: its routes are mounted, its notification channels describe delivery, its chat families run in-process, its deletion hooks run before a workspace row goes, and threads are served when one of its services is the session store. */
  runtime?: Partial<Pick<StartedCapabilities, 'workspaceRoutes' | 'platformRoutes' | 'chatFamilies' | 'notificationChannels' | 'workspaceAgents' | 'onWorkspaceDeleted' | 'service'>>
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const auth = deps.auth ?? developmentStrategy()
  const { product } = deps
  const capabilities = deps.capabilities ?? productCapabilityRegistry(product)
  const modules = deps.modules ?? createModuleRegistry(product.modules, capabilities)
  const pluginTypes = deps.pluginTypes ?? createPluginTypeRegistry([...product.pluginTypes, ...capabilities.definitions().flatMap(d => d.pluginTypes ?? [])])
  const families = deps.families ?? createSessionFamilyRegistry(SESSION_FAMILIES)
  const workspaceFacts = deps.workspaceFacts ?? createWorkspaceFactRegistry(declaredWorkspaceFacts(capabilities.definitions()))
  const locked = lockedSecretsStore()
  const secrets = deps.secrets ?? locked.writeOnly
  const native = deps.runtime?.chatFamilies ?? {}
  const workspaceAgents = createWorkspaceAgentRegistry(deps.runtime?.workspaceAgents ?? [])

  app.use(async (c, next) => {
    c.set('db', deps.db)
    c.set('paths', deps.paths)
    c.set('authStrategy', auth.name)
    c.set('capabilities', capabilities)
    c.set('modules', modules)
    c.set('pluginTypes', pluginTypes)
    c.set('families', families)
    c.set('workspaceFacts', workspaceFacts)
    c.set('workspaceAgents', workspaceAgents)
    c.set('secrets', secrets)
    c.set('scopeUrlPrefix', product.config.scope.urlPrefix)
    c.set('scopeListPath', product.config.scope.listPath)
    c.set('scopeLabel', product.config.scope.label)
    await next()
  })
  app.use(authMiddleware(auth))

  app.get(HEALTH_PATH, c => c.json<HealthResponse>({ status: 'ok' }))
  app.route(INFO_PATH, infoRoutes(product.config))
  app.route(AUTH_PATH, authRoutes(auth))
  app.route(WORKSPACES_PATH, workspaceRoutes(deps.secretsReader ?? locked, { onWorkspaceDeleted: deps.runtime?.onWorkspaceDeleted }))
  app.route(WORKSPACES_PATH, workspaceModuleRoutes())
  app.route(WORKSPACES_PATH, registryRoutes())
  app.route(WORKSPACES_PATH, activityRoutes())
  app.route(ACTIVITY_PATH, allActivityRoutes())
  app.route(WORKSPACES_PATH, notificationRoutes(deps.runtime?.notificationChannels ?? []))
  for (const routes of deps.runtime?.workspaceRoutes ?? []) app.route(WORKSPACES_PATH, routes)
  const sessions = deps.runtime?.service?.(THREAD_SESSIONS)
  if (sessions) app.route(WORKSPACES_PATH, threadRoutes(threadServiceFor(deps.db, sessions, { native, agents: workspaceAgents, scopeUrlPrefix: product.config.scope.urlPrefix, scopeLabel: product.config.scope.label })))
  app.route(ORGANISATIONS_PATH, organisationRoutes())
  app.route(GRANTS_PATH, grantRoutes())
  app.route(MODULES_PATH, moduleRoutes())
  app.route(CAPABILITY_CATALOG_PATH, capabilityRoutes())
  app.route(PLUGIN_TYPES_PATH, pluginTypeRoutes())
  app.route(PLUGINS_PATH, pluginInstanceRoutes(deps.secretsReader ?? locked))
  if (deps.secrets) app.route(PLATFORM_SETTINGS_PATH, platformSettingsRoutes(deps.secrets))
  for (const { path, routes } of deps.runtime?.platformRoutes ?? []) app.route(path, routes)

  return app
}
