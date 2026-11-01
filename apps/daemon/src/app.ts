import { Hono } from 'hono'
import { ACTIVITY_PATH, AUTH_PATH, CAPABILITY_CATALOG_PATH, GRANTS_PATH, HEALTH_PATH, INFO_PATH, MODULES_PATH, ORGANISATIONS_PATH, PLATFORM_SETTINGS_PATH, PLUGIN_TYPES_PATH, PLUGINS_PATH, PROJECTS_PATH, type Actor, type AuthStrategyName, type HealthResponse, type ScopeLabel } from '@candy-mountain/shared'
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
import { projectModuleRoutes } from './project-modules'
import { registryRoutes } from './registry'
import { organisationRoutes, projectRoutes } from './projects'
import { infoRoutes } from './routes/info'
import { lockedSecretsStore, type SecretsWriter } from './secrets'
import { platformSettingsRoutes } from './settings'
import { createSessionFamilyRegistry, SESSION_FAMILIES, THREAD_BOTS, THREAD_SESSIONS, threadRoutes, threadServiceFor, type SessionFamilyRegistry } from './threads'

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
  /** The started definition list: its routes are mounted, its chat families run in-process, its deletion hooks run before a project row goes, and threads are served when one of its services is the session store. */
  runtime?: Partial<Pick<StartedCapabilities, 'workspaceRoutes' | 'platformRoutes' | 'chatFamilies' | 'onWorkspaceDeleted' | 'service'>>
}

export interface AppVariables {
  db: Db
  paths: DataPaths
  authStrategy: AuthStrategyName
  capabilities: CapabilityRegistry
  modules: ModuleRegistry
  pluginTypes: PluginTypeRegistry
  families: SessionFamilyRegistry
  secrets: SecretsWriter
  /** The product's `scope.urlPrefix`, for links into the web app. */
  scopeUrlPrefix: string
  /** The product's `scope.label`, for daemon-written text that names a workspace. */
  scopeLabel: ScopeLabel
  /** Set by the auth middleware on every non-public route; public routes must not read it. */
  actor: Actor
}

export interface AppEnv {
  Variables: AppVariables
}

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>()
  const auth = deps.auth ?? developmentStrategy()
  const { product } = deps
  const capabilities = deps.capabilities ?? productCapabilityRegistry(product)
  const modules = deps.modules ?? createModuleRegistry(product.modules, capabilities)
  const pluginTypes = deps.pluginTypes ?? createPluginTypeRegistry([...product.pluginTypes, ...capabilities.definitions().flatMap(d => d.pluginTypes ?? [])])
  const families = deps.families ?? createSessionFamilyRegistry(SESSION_FAMILIES)
  const locked = lockedSecretsStore()
  const secrets = deps.secrets ?? locked.writeOnly
  const native = deps.runtime?.chatFamilies ?? {}

  app.use(async (c, next) => {
    c.set('db', deps.db)
    c.set('paths', deps.paths)
    c.set('authStrategy', auth.name)
    c.set('capabilities', capabilities)
    c.set('modules', modules)
    c.set('pluginTypes', pluginTypes)
    c.set('families', families)
    c.set('secrets', secrets)
    c.set('scopeUrlPrefix', product.config.scope.urlPrefix)
    c.set('scopeLabel', product.config.scope.label)
    await next()
  })
  app.use(authMiddleware(auth))

  app.get(HEALTH_PATH, c => c.json<HealthResponse>({ status: 'ok' }))
  app.route(INFO_PATH, infoRoutes(product.config))
  app.route(AUTH_PATH, authRoutes(auth))
  app.route(PROJECTS_PATH, projectRoutes(deps.secretsReader ?? locked, { onWorkspaceDeleted: deps.runtime?.onWorkspaceDeleted }))
  app.route(PROJECTS_PATH, projectModuleRoutes())
  app.route(PROJECTS_PATH, registryRoutes())
  app.route(PROJECTS_PATH, activityRoutes())
  app.route(ACTIVITY_PATH, allActivityRoutes())
  app.route(PROJECTS_PATH, notificationRoutes())
  for (const routes of deps.runtime?.workspaceRoutes ?? []) app.route(PROJECTS_PATH, routes)
  const sessions = deps.runtime?.service?.(THREAD_SESSIONS)
  if (sessions) app.route(PROJECTS_PATH, threadRoutes(threadServiceFor(deps.db, sessions, { native, bots: deps.runtime?.service?.(THREAD_BOTS), scopeUrlPrefix: product.config.scope.urlPrefix })))
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
