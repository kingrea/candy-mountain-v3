import { createHash, randomBytes } from 'node:crypto'
import { eq, lte } from 'drizzle-orm'
import type { Db } from '../db'
import { authSessions } from '../db/schema'

// Writing last_seen_at on every request would turn each read into a write.
const LAST_SEEN_RESOLUTION_MS = 60_000

export interface SessionClock {
  now(): Date
}

export const systemClock: SessionClock = { now: () => new Date() }

export interface CreatedSession {
  token: string
  expiresAt: Date
}

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(db: Db, userId: string, ttlMs: number, clock: SessionClock = systemClock): CreatedSession {
  const now = clock.now()
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + ttlMs)
  db.insert(authSessions).values({
    id: sessionId(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastSeenAt: now.toISOString(),
  }).run()
  return { token, expiresAt }
}

/** Returns the session's user id, or null for unknown or expired tokens (expired ones are deleted). */
export function resolveSession(db: Db, token: string, clock: SessionClock = systemClock): string | null {
  const id = sessionId(token)
  const session = db.select().from(authSessions).where(eq(authSessions.id, id)).get()
  if (!session) return null
  const now = clock.now()
  if (new Date(session.expiresAt) <= now) {
    db.delete(authSessions).where(eq(authSessions.id, id)).run()
    return null
  }
  if (now.getTime() - new Date(session.lastSeenAt).getTime() >= LAST_SEEN_RESOLUTION_MS) {
    db.update(authSessions).set({ lastSeenAt: now.toISOString() }).where(eq(authSessions.id, id)).run()
  }
  return session.userId
}

export function deleteSession(db: Db, token: string): void {
  db.delete(authSessions).where(eq(authSessions.id, sessionId(token))).run()
}

export function deleteExpiredSessions(db: Db, clock: SessionClock = systemClock): number {
  return db.delete(authSessions).where(lte(authSessions.expiresAt, clock.now().toISOString())).run().changes
}
