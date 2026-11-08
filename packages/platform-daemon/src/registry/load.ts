import { isAdmin, type Actor, type Workspace, type RegistryResponse, type ScopeLabel } from '@candy-mountain/platform-sdk'
import type { AccessDeps } from '../grants/access'
import { resolveActorRungs } from '../grants/resolve'
import { resolvePluginInstance, type PluginInstanceDeps } from '../plugins/instances/instances'
import { listEnabledModules } from '../workspace-modules/enablement'
import { LLM_GATEWAY_SECRET_NAME, LLM_GATEWAY_SECRET_OWNER, readPlatformSettings } from '../settings/platform-settings'
import type { WorkspaceAgentRegistry } from '../threads/agents'
import { computeRegistry, type RegistryInput } from './compute'
import type { WorkspaceFactRegistry } from './facts'
import { assessPluginInstance, requiredPluginTypes, type PlatformFacts, type PluginReadiness, type WorkspaceFacts } from './readiness'

/** `c.var` satisfies this; readiness messages name the workspace with the product's `scope.label`, facts come from the registered declarations and workspace agents from the started definitions. */
export type RegistryDeps = AccessDeps & PluginInstanceDeps & { scopeLabel: ScopeLabel, workspaceFacts: WorkspaceFactRegistry, workspaceAgents?: WorkspaceAgentRegistry }

/** Building view links also needs the product's `scope.urlPrefix`, and the system group its `scope.listPath`. */
export type RegistryLoadDeps = RegistryDeps & { scopeUrlPrefix: string, scopeListPath: string }

/** Each declared fact asked of the definition that declares it; the platform knows no fact of its own here. */
export const workspaceFacts = (deps: Pick<RegistryDeps, 'db' | 'workspaceFacts'>, workspace: Pick<Workspace, 'id'>): WorkspaceFacts => deps.workspaceFacts.compute(deps.db, workspace)

/** Only whether the key exists is read, so this never needs the secrets master key. */
export function platformFacts(deps: Pick<RegistryDeps, 'db' | 'secrets'>): PlatformFacts {
  const settings = readPlatformSettings(deps.db, deps.secrets)
  return { llmGateway: settings.gatewayBaseUrl !== null && settings.modelId !== null && deps.secrets.isSet(LLM_GATEWAY_SECRET_OWNER, LLM_GATEWAY_SECRET_NAME) }
}

/** The workspace's own instance, else the global one, judged on its stored health. */
export function loadPluginReadiness(deps: RegistryDeps, workspaceId: string, typeIds: Iterable<string>): Record<string, PluginReadiness> {
  const readiness: Record<string, PluginReadiness> = {}
  for (const typeId of new Set(typeIds)) {
    readiness[typeId] = assessPluginInstance(typeId, deps.pluginTypes.byId(typeId), resolvePluginInstance(deps, workspaceId, typeId as never))
  }
  return readiness
}

export function loadRegistryInput(deps: RegistryLoadDeps, actor: Actor, workspace: Workspace): RegistryInput {
  const capabilities = deps.capabilities.list()
  return {
    workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
    scopeUrlPrefix: deps.scopeUrlPrefix,
    scopeListPath: deps.scopeListPath,
    scopeLabel: deps.scopeLabel,
    capabilities,
    modules: deps.modules.list(),
    enabledModules: listEnabledModules(deps.db, workspace.id, deps.modules),
    rungs: resolveActorRungs(deps, actor),
    admin: isAdmin(actor),
    plugins: loadPluginReadiness(deps, workspace.id, capabilities.flatMap(requiredPluginTypes)),
    facts: workspaceFacts(deps, workspace),
    factMessages: deps.workspaceFacts.messages(),
    platformFacts: platformFacts(deps),
    workspaceAgents: (deps.workspaceAgents?.list(workspace.id) ?? []).filter(listing => listing.usable).map(({ agent, capabilityId }) => ({ ...agent, capabilityId, kind: 'workspace' as const })),
  }
}

export const loadRegistry = (deps: RegistryLoadDeps, actor: Actor, workspace: Workspace): RegistryResponse => computeRegistry(loadRegistryInput(deps, actor, workspace))
