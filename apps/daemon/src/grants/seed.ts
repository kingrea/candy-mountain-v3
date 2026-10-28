import { ADMIN_ROLE } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { topRung } from '../capabilities'
import { roleGrants, roles } from '../db/schema'
import type { AccessDeps } from './access'

/** Gives the admin role a grant on every module at each member's top rung; existing grants are left as they are. */
export function seedAdminGrants({ db, capabilities, modules }: AccessDeps): void {
  const role = db.select({ id: roles.id }).from(roles).where(eq(roles.slug, ADMIN_ROLE)).get()
  if (!role) return
  const now = new Date().toISOString()
  db.transaction((tx) => {
    for (const mod of modules.list()) {
      const rungs = Object.fromEntries(mod.capabilities.map(m => [m.capabilityId, topRung(capabilities.get(m.capabilityId)).name]))
      tx.insert(roleGrants)
        .values({ id: randomUUID(), roleId: role.id, targetKind: 'module', targetId: mod.id, rungs, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .run()
    }
  })
}
