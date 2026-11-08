import { isAdmin, type Actor, type AgentSession, type AgentSessionFamily, type ApiErrorBody, type Workspace } from '@candy-mountain/platform-sdk'
import type { MiddlewareHandler } from 'hono'
import { type AppEnv, familyCapability, gateChat, type GateResult, getWorkspaceBySlug, type RegistryDeps, SessionError } from '@candy-mountain/platform-daemon'
import type { SessionManager } from './manager'

export function gateSessionFamily(deps: RegistryDeps, actor: Actor, workspace: Workspace, family: AgentSessionFamily): GateResult {
  const capabilityId = familyCapability(deps.capabilities, family)
  if (!capabilityId) return { allowed: false, code: 'capability_unknown', status: 404, reason: `No capability runs '${family}' sessions.` }
  return gateChat(deps, actor, workspace, capabilityId)
}

// Admins see every session because bot sessions belong to a synthetic actor no human signs in as.
export const canAccessSession = (actor: Actor, session: AgentSession): boolean => session.actorId === actor.id || isAdmin(actor)

/** Another actor's session is reported missing rather than forbidden. */
export function requireSessionAccess(sessions: SessionManager): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug')!, c.var.scopeLabel)
    const id = c.req.param('id')!
    const session = sessions.get(id)
    if (!session || session.workspaceId !== workspace.id || !canAccessSession(c.var.actor, session)) throw new SessionError('not_found', `No session with id "${id}" in this project`)
    const result = gateSessionFamily(c.var, c.var.actor, workspace, session.family)
    if (!result.allowed) return c.json<ApiErrorBody>({ error: { code: result.code, message: result.reason } }, result.status)
    await next()
  }
}
