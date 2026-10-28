import { randomUUID } from 'node:crypto'
import { ADMIN_ROLE, ADMIN_USERNAME } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { roles, userRoles, users } from '../db/schema'

export function seedAuth(db: Db): void {
  const now = new Date().toISOString()
  db.transaction((tx) => {
    tx.insert(roles)
      .values({ id: randomUUID(), slug: ADMIN_ROLE, name: 'Administrator', createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: roles.slug })
      .run()
    tx.insert(users)
      .values({ id: randomUUID(), username: ADMIN_USERNAME, displayName: 'Admin', createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: users.username })
      .run()
    const role = tx.select({ id: roles.id }).from(roles).where(eq(roles.slug, ADMIN_ROLE)).get()!
    const user = tx.select({ id: users.id }).from(users).where(eq(users.username, ADMIN_USERNAME)).get()!
    tx.insert(userRoles).values({ userId: user.id, roleId: role.id, createdAt: now }).onConflictDoNothing().run()
  })
}
