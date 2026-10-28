import { isAdmin, NONE_RUNG, type Actor, type CapabilityId, type CapabilityRungs } from '@candy-mountain/shared'
import { rungIndex, topRung } from '../capabilities'
import type { AccessDeps } from './access'
import { listGrants } from './grants'

/** Fails closed: any error resolves every capability to 'none'. */
export function resolveRoleRungs({ db, capabilities, modules }: AccessDeps, roleSlugs: readonly string[]): CapabilityRungs {
  const none = (): CapabilityRungs => Object.fromEntries(capabilities.list().map(cap => [cap.id, NONE_RUNG]))
  try {
    if (isAdmin({ roles: [...roleSlugs] })) return Object.fromEntries(capabilities.list().map(cap => [cap.id, topRung(cap).name]))

    const resolved = none()
    const raise = (capabilityId: string, rung: string | undefined) => {
      const cap = capabilities.byId(capabilityId)
      if (!cap || rung === undefined) return
      // A rung no longer on the ladder grants nothing rather than failing the actor's other grants.
      if (rungIndex(cap, rung) > rungIndex(cap, resolved[cap.id] ?? NONE_RUNG)) resolved[cap.id] = rung
    }
    for (const cap of capabilities.list()) raise(cap.id, cap.everyoneRung)
    for (const grant of listGrants(db, roleSlugs)) {
      if (grant.target.kind === 'capability') {
        raise(grant.target.id, grant.rungs[grant.target.id])
        continue
      }
      for (const member of modules.byId(grant.target.id)?.capabilities ?? []) {
        raise(member.capabilityId, grant.rungs[member.capabilityId] ?? member.defaultRung)
      }
    }
    return resolved
  }
  catch (error) {
    console.error(`Rung resolution failed, denying everything: ${error instanceof Error ? error.message : String(error)}`)
    return none()
  }
}

export const resolveActorRungs = (deps: AccessDeps, actor: Pick<Actor, 'roles'>): CapabilityRungs => resolveRoleRungs(deps, actor.roles)

export const rungOf = (rungs: CapabilityRungs, capabilityId: CapabilityId): string => rungs[capabilityId] ?? NONE_RUNG
