import type { Actor } from '@candy-mountain/shared'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { roles, userRoles, users } from '../db/schema'

type UserRow = typeof users.$inferSelect

function toActor(db: Db, user: UserRow): Actor {
  const roleSlugs = db.select({ slug: roles.slug })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, user.id))
    .orderBy(asc(roles.slug))
    .all()
    .map(row => row.slug)
  return { id: user.id, username: user.username, displayName: user.displayName, roles: roleSlugs }
}

export function findActorById(db: Db, id: string): Actor | null {
  const user = db.select().from(users).where(eq(users.id, id)).get()
  return user ? toActor(db, user) : null
}

export function findActorByUsername(db: Db, username: string): Actor | null {
  const user = db.select().from(users).where(eq(users.username, username)).get()
  return user ? toActor(db, user) : null
}
