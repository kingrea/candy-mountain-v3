import type { AgentSession, AgentSessionEvent, AgentSessionEventPayload, AgentSessionStatus } from '@candy-mountain/shared'
import { and, asc, eq, gt, max, ne } from 'drizzle-orm'
import type { Db } from '../db'
import { agentSessionEvents, agentSessions } from '../db/schema'

type SessionRow = typeof agentSessions.$inferSelect
type EventRow = typeof agentSessionEvents.$inferSelect

const toSession = (row: SessionRow): AgentSession => ({ ...row, posture: row.posture ?? null })

const toEvent = (row: EventRow): AgentSessionEvent => ({ seq: row.seq, at: row.createdAt, kind: row.kind, ...row.payload } as AgentSessionEvent)

export function insertSession(db: Db, row: SessionRow): AgentSession {
  db.insert(agentSessions).values(row).run()
  return toSession(row)
}

export function findSession(db: Db, id: string): AgentSession | null {
  const row = db.select().from(agentSessions).where(eq(agentSessions.id, id)).get()
  return row ? toSession(row) : null
}

export function listSessions(db: Db, projectId: string): AgentSession[] {
  return db.select().from(agentSessions).where(eq(agentSessions.projectId, projectId)).orderBy(asc(agentSessions.createdAt), asc(agentSessions.id)).all().map(toSession)
}

export interface SessionPatch {
  status?: AgentSessionStatus
  upstreamSessionId?: string
  lastActivityAt?: string
}

export function updateSession(db: Db, id: string, patch: SessionPatch): void {
  db.update(agentSessions).set(patch).where(eq(agentSessions.id, id)).run()
}

/** Nothing is live after a restart, whatever the rows said when the daemon stopped. */
export function resetSessionStatuses(db: Db): void {
  db.update(agentSessions).set({ status: 'idle' }).where(ne(agentSessions.status, 'idle')).run()
}

export function appendSessionEvent(db: Db, sessionId: string, payload: AgentSessionEventPayload, at: string): AgentSessionEvent {
  const { kind, ...rest } = payload
  return db.transaction((tx) => {
    const last = tx.select({ seq: max(agentSessionEvents.seq) }).from(agentSessionEvents).where(eq(agentSessionEvents.sessionId, sessionId)).get()
    const row: EventRow = { sessionId, seq: (last?.seq ?? 0) + 1, kind, payload: rest, createdAt: at }
    tx.insert(agentSessionEvents).values(row).run()
    tx.update(agentSessions).set({ lastActivityAt: at }).where(eq(agentSessions.id, sessionId)).run()
    return toEvent(row)
  })
}

export function listSessionEvents(db: Db, sessionId: string, { after = 0 }: { after?: number } = {}): AgentSessionEvent[] {
  return db.select().from(agentSessionEvents)
    .where(and(eq(agentSessionEvents.sessionId, sessionId), gt(agentSessionEvents.seq, after)))
    .orderBy(asc(agentSessionEvents.seq))
    .all()
    .map(toEvent)
}
