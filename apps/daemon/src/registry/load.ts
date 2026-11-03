import { BOTS_CAPABILITY_ID, isAdmin, type Actor, type Workspace, type RegistryResponse, type ScopeLabel } from '@candy-mountain/shared'
import { listWorkspaceBotRefs } from '../bots/bots'
import type { AccessDeps } from '../grants/access'
import { resolveActorRungs } from '../grants/resolve'
import { resolvePluginInstance, type PluginInstanceDeps } from '../plugins/instances/instances'
import { listEnabledModules } from '../workspace-modules/enablement'
import { LLM_GATEWAY_SECRET_NAME, LLM_GATEWAY_SECRET_OWNER, readPlatformSettings } from '../settings/platform-settings'
import { computeRegistry, type RegistryInput } from './compute'
import type { WorkspaceFactRegistry } from './facts'
import { assessPluginInstance, requiredPluginTypes, type PlatformFacts, type PluginReadiness, type WorkspaceFacts } from './readiness'

/** `c.var` satisfies this; readiness messages name the workspace with the product's `scope.label`, and facts come from the registered declarations. */
export type RegistryDeps = AccessDeps & PluginInstanceDeps & { scopeLabel: ScopeLabel, workspaceFacts: WorkspaceFactRegistry }

/** Building view links also needs the product's `scope.urlPrefix`. */
export type RegistryLoadDeps = RegistryDeps & { scopeUrlPrefix: string }

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
    // The bots capability's table exists only when the product boots it.
    bots: deps.capabilities.has(BOTS_CAPABILITY_ID) ? listWorkspaceBotRefs(deps, workspace.id).filter(bot => bot.usable) : [],
  }
}

export const loadRegistry = (deps: RegistryLoadDeps, actor: Actor, workspace: Workspace): RegistryResponse => computeRegistry(loadRegistryInput(deps, actor, workspace))
