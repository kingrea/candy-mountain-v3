import { randomUUID } from 'node:crypto'
import { GRANT_TARGET_KINDS, type CapabilityRungs, type GrantTarget, type RoleGrant, type SetGrantRequest } from '@candy-mountain/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { rungIndex } from '../capabilities'
import type { Db } from '../db'
import { roleGrants, roles } from '../db/schema'
import type { AccessDeps } from './access'
import { GrantError } from './errors'

const grantColumns = {
  role: roles.slug,
  targetKind: roleGrants.targetKind,
  targetId: roleGrants.targetId,
  rungs: roleGrants.rungs,
  createdAt: roleGrants.createdAt,
  updatedAt: roleGrants.updatedAt,
}

type GrantRow = Omit<typeof roleGrants.$inferSelect, 'id' | 'roleId'> & { role: string }

const toGrant = (row: GrantRow): RoleGrant => ({
  role: row.role,
  target: { kind: row.targetKind, id: row.targetId } as GrantTarget,
  rungs: row.rungs as CapabilityRungs,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

/** Every grant, or only those of the given role slugs. */
export function listGrants(db: Db, roleSlugs?: readonly string[]): RoleGrant[] {
  if (roleSlugs && !roleSlugs.length) return []
  return db.select(grantColumns)
    .from(roleGrants)
    .innerJoin(roles, eq(roles.id, roleGrants.roleId))
    .where(roleSlugs ? inArray(roles.slug, [...roleSlugs]) : undefined)
    .orderBy(asc(roles.slug), asc(roleGrants.targetKind), asc(roleGrants.targetId))
    .all()
    .map(toGrant)
}

export function findGrant(db: Db, role: string, target: GrantTarget): RoleGrant | null {
  const row = db.select(grantColumns)
    .from(roleGrants)
    .innerJoin(roles, eq(roles.id, roleGrants.roleId))
    .where(and(eq(roles.slug, role), eq(roleGrants.targetKind, target.kind), eq(roleGrants.targetId, target.id)))
    .get()
  return row ? toGrant(row) : null
}

/** Checks the request against the registries; module members left out get their default rung, so the stored grant is explicit. */
export function normaliseGrant({ capabilities, modules }: Omit<AccessDeps, 'db'>, request: SetGrantRequest): CapabilityRungs {
  const { target, rungs } = request
  const named = Object.entries(rungs)
  const checkRung = (capabilityId: string, rung: unknown) => {
    const cap = capabilities.byId(capabilityId)
    if (typeof rung !== 'string' || !cap || rungIndex(cap, rung) < 0) {
      const ladder = cap ? ` (${cap.ladder.map(r => r.name).join(', ')})` : ''
      throw new GrantError('invalid_rung', `'${String(rung)}' is not a rung of capability '${capabilityId}'${ladder}`)
    }
  }

  if (target.kind === 'module') {
    const mod = modules.byId(target.id)
    if (!mod) throw new GrantError('target_not_found', `Module '${target.id}' is not registered`)
    const members = new Map(mod.capabilities.map(m => [m.capabilityId as string, m.defaultRung]))
    for (const [capabilityId, rung] of named) {
      if (!members.has(capabilityId)) throw new GrantError('invalid_rung', `Capability '${capabilityId}' is not in module '${mod.id}'`)
      checkRung(capabilityId, rung)
    }
    return Object.fromEntries([...members].map(([capabilityId, fallback]) => [capabilityId, rungs[capabilityId as never] ?? fallback]))
  }

  if (!capabilities.has(target.id)) throw new GrantError('target_not_found', `Capability '${target.id}' is not registered`)
  const extra = named.filter(([capabilityId]) => capabilityId !== target.id)
  if (extra.length || !named.length) {
    throw new GrantError('invalid_rung', `A grant on capability '${target.id}' sets a rung for '${target.id}' only`)
  }
  checkRung(target.id, rungs[target.id])
  return { [target.id]: rungs[target.id] }
}

/** Creates or replaces the role's grant on the target. */
export function setGrant(deps: AccessDeps, request: SetGrantRequest): RoleGrant {
  const rungs = normaliseGrant(deps, request)
  const role = deps.db.select({ id: roles.id }).from(roles).where(eq(roles.slug, request.role)).get()
  if (!role) throw new GrantError('role_not_found', `Role '${request.role}' does not exist`)
  const now = new Date().toISOString()
  deps.db.insert(roleGrants)
    .values({ id: randomUUID(), roleId: role.id, targetKind: request.target.kind, targetId: request.target.id, rungs, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [roleGrants.roleId, roleGrants.targetKind, roleGrants.targetId], set: { rungs, updatedAt: now } })
    .run()
  return findGrant(deps.db, request.role, request.target)!
}

export function parseSetGrant(value: unknown): SetGrantRequest {
  const body = object(value, 'Request body')
  if (typeof body.role !== 'string' || !body.role) throw new GrantError('invalid_request', 'role must be a role slug')
  const target = object(body.target, 'target')
  if (!GRANT_TARGET_KINDS.includes(target.kind as never)) {
    throw new GrantError('invalid_request', `target.kind must be one of: ${GRANT_TARGET_KINDS.join(', ')}`)
  }
  if (typeof target.id !== 'string' || !target.id) throw new GrantError('invalid_request', 'target.id must be a string')
  const rungs = object(body.rungs ?? {}, 'rungs')
  for (const [key, rung] of Object.entries(rungs)) {
    if (typeof rung !== 'string') throw new GrantError('invalid_request', `rungs.${key} must be a rung name`)
  }
  return { role: body.role, target: { kind: target.kind, id: target.id } as GrantTarget, rungs: rungs as CapabilityRungs }
}

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new GrantError('invalid_request', `${what} must be a JSON object`)
  return value as Record<string, unknown>
}
