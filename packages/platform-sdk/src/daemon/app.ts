import type { Actor, AuthStrategyName, ScopeLabel } from '../index'
import type { DataPaths } from './data-paths'
import type { Db } from './db'
import type { SessionFamilyRegistry } from './families'
import type { WorkspaceFactRegistry } from './facts'
import type { CapabilityRegistry, ModuleRegistry, PluginTypeRegistry } from './registries'
import type { SecretsWriter } from './secrets'
import type { WorkspaceAgentRegistry } from './workspace-agents'

/** What every route handler reads from `c.var`. */
export interface AppVariables {
  db: Db
  paths: DataPaths
  authStrategy: AuthStrategyName
  capabilities: CapabilityRegistry
  modules: ModuleRegistry
  pluginTypes: PluginTypeRegistry
  families: SessionFamilyRegistry
  /** The declared workspace facts the registry and gates compute per workspace. */
  workspaceFacts: WorkspaceFactRegistry
  /** The agents the started definitions add per workspace, for the registry and the thread routes. */
  workspaceAgents: WorkspaceAgentRegistry
  secrets: SecretsWriter
  /** The product's `scope.urlPrefix`, for links into the web app. */
  scopeUrlPrefix: string
  /** The product's `scope.listPath`, for the system nav entry. */
  scopeListPath: string
  /** The product's `scope.label`, for daemon-written text that names a workspace. */
  scopeLabel: ScopeLabel
  /** Set by the auth middleware on every non-public route; public routes must not read it. */
  actor: Actor
}

export interface AppEnv {
  Variables: AppVariables
}
