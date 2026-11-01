import { isAdmin, type Actor, type Project, type RegistryResponse, type ScopeLabel } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { listProjectBotRefs } from '../bots/bots'
import type { Db } from '../db'
import { bots } from '../db/schema'
import type { AccessDeps } from '../grants/access'
import { resolveActorRungs } from '../grants/resolve'
import { resolvePluginInstance, type PluginInstanceDeps } from '../plugins/instances/instances'
import { listEnabledModules } from '../project-modules/enablement'
import { LLM_GATEWAY_SECRET_NAME, LLM_GATEWAY_SECRET_OWNER, readPlatformSettings } from '../settings/platform-settings'
import { computeRegistry, type RegistryInput } from './compute'
import { assessPluginInstance, requiredPluginTypes, type PlatformFacts, type PluginReadiness, type ProjectFacts } from './readiness'

/** `c.var` satisfies this; readiness messages name the workspace with the product's `scope.label`. */
export type RegistryDeps = AccessDeps & PluginInstanceDeps & { scopeLabel: ScopeLabel }

/** Building view links also needs the product's `scope.urlPrefix`. */
export type RegistryLoadDeps = RegistryDeps & { scopeUrlPrefix: string }

/** Counts rows directly because `listBots` resolves base branches over the network, too slow for every registry read. */
export const projectFacts = (db: Db, project: Pick<Project, 'id' | 'verification'>): ProjectFacts => ({
  hasBeads: project.verification.hasBeads,
  isGitRepo: project.verification.isGitRepo,
  hasRemote: project.verification.hasRemote,
  hasBots: db.select({ id: bots.id }).from(bots).where(eq(bots.projectId, project.id)).limit(1).get() !== undefined,
})

/** Only whether the key exists is read, so this never needs the secrets master key. */
export function platformFacts(deps: Pick<RegistryDeps, 'db' | 'secrets'>): PlatformFacts {
  const settings = readPlatformSettings(deps.db, deps.secrets)
  return { llmGateway: settings.gatewayBaseUrl !== null && settings.modelId !== null && deps.secrets.isSet(LLM_GATEWAY_SECRET_OWNER, LLM_GATEWAY_SECRET_NAME) }
}

/** The workspace's own instance, else the global one, judged on its stored health. */
export function loadPluginReadiness(deps: RegistryDeps, projectId: string, typeIds: Iterable<string>): Record<string, PluginReadiness> {
  const readiness: Record<string, PluginReadiness> = {}
  for (const typeId of new Set(typeIds)) {
    readiness[typeId] = assessPluginInstance(typeId, deps.pluginTypes.byId(typeId), resolvePluginInstance(deps, projectId, typeId as never))
  }
  return readiness
}

export function loadRegistryInput(deps: RegistryLoadDeps, actor: Actor, project: Project): RegistryInput {
  const capabilities = deps.capabilities.list()
  return {
    project: { id: project.id, slug: project.slug, name: project.name },
    scopeUrlPrefix: deps.scopeUrlPrefix,
    scopeLabel: deps.scopeLabel,
    capabilities,
    modules: deps.modules.list(),
    enabledModules: listEnabledModules(deps.db, project.id, deps.modules),
    rungs: resolveActorRungs(deps, actor),
    admin: isAdmin(actor),
    plugins: loadPluginReadiness(deps, project.id, capabilities.flatMap(requiredPluginTypes)),
    facts: projectFacts(deps.db, project),
    platformFacts: platformFacts(deps),
    bots: listProjectBotRefs(deps, project.id).filter(bot => bot.usable),
  }
}

export const loadRegistry = (deps: RegistryLoadDeps, actor: Actor, project: Project): RegistryResponse => computeRegistry(loadRegistryInput(deps, actor, project))
