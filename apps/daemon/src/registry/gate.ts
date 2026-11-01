import { isAdmin, type Actor, type AnyCapabilityManifest, type ApiErrorBody, type CapabilityId, type GateRefusalCode, type Project, type ReadinessReason, type Rung, type ScopeLabel } from '@candy-mountain/shared'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'
import { resolveActorRungs } from '../grants/resolve'
import { findProjectBySlug } from '../projects/projects'
import { listEnabledModules } from '../project-modules/enablement'
import { actorRung, candidateModules } from './compute'
import { loadPluginReadiness, platformFacts, projectFacts, type RegistryDeps } from './load'
import { capabilityReadiness, requiredPluginTypes } from './readiness'

/** Everything a gate needs, gathered once per request so the checks themselves are pure. */
export interface CapabilityAccess {
  capabilityId: string
  projectSlug: string
  scopeLabel: ScopeLabel
  admin: boolean
  capability: AnyCapabilityManifest | undefined
  /** In an enabled module, or standalone. */
  enabled: boolean
  rung: Rung | undefined
  reasons: ReadinessReason[]
}

export interface GateRefusal {
  allowed: false
  code: GateRefusalCode
  reason: string
  status: 403 | 404 | 409
}

export type GateResult = { allowed: true, rung: string, scope?: string } | GateRefusal

const refuse = (code: GateRefusalCode, status: GateRefusal['status'], reason: string): GateRefusal => ({ allowed: false, code, reason, status })

function common(access: CapabilityAccess, grants: (rung: Rung) => GateResult): GateResult {
  const { capabilityId, projectSlug, scopeLabel } = access
  if (!access.capability || !access.rung) return refuse('capability_unknown', 404, `Capability '${capabilityId}' is not registered.`)
  if (!access.enabled) return refuse('not_enabled', 404, `Capability '${capabilityId}' is not enabled for ${scopeLabel.singular} '${projectSlug}'.`)
  const result = grants(access.rung)
  if (!result.allowed || !access.reasons.length) return result
  // Readiness details name plugins and their state, which only the admin manages.
  const detail = access.admin ? ` ${access.reasons.map(r => r.message).join(' ')}` : ''
  return refuse('not_ready', 409, `Capability '${capabilityId}' is not ready for ${scopeLabel.singular} '${projectSlug}'.${detail}`)
}

export function checkView(access: CapabilityAccess, viewId: string): GateResult {
  return common(access, rung => (rung.views.includes(viewId)
    ? { allowed: true, rung: rung.name }
    : refuse('not_granted', 403, `Rung '${rung.name}' of '${access.capabilityId}' does not show view '${viewId}'.`)))
}

/** Allowed results carry the widest scope level the rung grants on a scoped tool. */
export function checkTool(access: CapabilityAccess, toolId: string): GateResult {
  return common(access, (rung) => {
    const permission = rung.tools[toolId]
    if (!permission) return refuse('not_granted', 403, `Rung '${rung.name}' of '${access.capabilityId}' does not grant tool '${toolId}'.`)
    return permission.scope === undefined ? { allowed: true, rung: rung.name } : { allowed: true, rung: rung.name, scope: permission.scope }
  })
}

export function checkChat(access: CapabilityAccess): GateResult {
  return common(access, rung => (rung.chat
    ? { allowed: true, rung: rung.name }
    : refuse('not_granted', 403, `Rung '${rung.name}' of '${access.capabilityId}' does not allow chat.`)))
}

export function resolveCapabilityAccess(deps: RegistryDeps, actor: Actor, project: Project, capabilityId: string): CapabilityAccess {
  const capability = deps.capabilities.byId(capabilityId)
  const base = { capabilityId, projectSlug: project.slug, scopeLabel: deps.scopeLabel, admin: isAdmin(actor) }
  if (!capability) return { ...base, capability: undefined, enabled: false, rung: undefined, reasons: [] }
  const { members, standalone } = candidateModules(capability, deps.modules.list(), listEnabledModules(deps.db, project.id, deps.modules))
  return {
    ...base,
    capability,
    enabled: members.length > 0 || standalone,
    rung: actorRung(capability, resolveActorRungs(deps, actor)),
    reasons: capabilityReadiness(capability, deps.scopeLabel, loadPluginReadiness(deps, project.id, requiredPluginTypes(capability)), projectFacts(deps.db, project), platformFacts(deps)),
  }
}

export const gateView = (deps: RegistryDeps, actor: Actor, project: Project, capabilityId: CapabilityId, viewId: string): GateResult =>
  checkView(resolveCapabilityAccess(deps, actor, project, capabilityId), viewId)

export const gateTool = (deps: RegistryDeps, actor: Actor, project: Project, capabilityId: CapabilityId, toolId: string): GateResult =>
  checkTool(resolveCapabilityAccess(deps, actor, project, capabilityId), toolId)

export const gateChat = (deps: RegistryDeps, actor: Actor, project: Project, capabilityId: CapabilityId): GateResult =>
  checkChat(resolveCapabilityAccess(deps, actor, project, capabilityId))

export type GateRequirement = { view: string } | { tool: string } | { chat: true }

export interface GateMiddlewareOptions {
  capability: CapabilityId
  /** Route param holding the workspace slug. */
  slugParam?: string
}

/** Mount on a workspace route after auth: a refusal becomes its error body, an unknown slug a 404. */
export function requireCapability(options: GateMiddlewareOptions & GateRequirement): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const slug = c.req.param(options.slugParam ?? 'slug') ?? ''
    const project = findProjectBySlug(c.var.db, slug)
    if (!project) return c.json<ApiErrorBody>({ error: { code: 'not_found', message: `No ${c.var.scopeLabel.singular} with slug "${slug}"` } }, 404)
    const access = resolveCapabilityAccess(c.var, c.var.actor, project, options.capability)
    const result = 'view' in options ? checkView(access, options.view) : 'tool' in options ? checkTool(access, options.tool) : checkChat(access)
    if (!result.allowed) return c.json<ApiErrorBody>({ error: { code: result.code, message: result.reason } }, result.status)
    await next()
  }
}
