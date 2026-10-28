import type { AgentSessionEvent, Decision } from '@candy-mountain/shared'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { agentSessionEvents } from '../db/schema'
import { listSessionEvents } from '../sessions/store'

export function foldDecisions(events: readonly AgentSessionEvent[]): Decision[] {
  const decisions = new Map<string, Decision>()
  for (const event of events) {
    if (event.kind === 'decision_opened') decisions.set(event.decision.id, structuredClone(event.decision))
    else if (event.kind === 'decision_answered') {
      const decision = decisions.get(event.decisionId)
      if (decision) Object.assign(decision, { state: 'answered', answer: event.answer })
    }
    else if (event.kind === 'decision_expired') {
      const decision = decisions.get(event.decisionId)
      if (decision) Object.assign(decision, { state: 'expired', expiry: event.expiry })
    }
  }
  return [...decisions.values()]
}

export function loggedDecisions(db: Db, sessionId: string): Decision[] {
  return foldDecisions(listSessionEvents(db, sessionId))
}

export function findLoggedDecision(db: Db, decisionId: string): Decision | null {
  const row = db.select({ sessionId: agentSessionEvents.sessionId }).from(agentSessionEvents)
    .where(and(eq(agentSessionEvents.kind, 'decision_opened'), sql`json_extract(${agentSessionEvents.payload}, '$.decision.id') = ${decisionId}`))
    .get()
  return row ? loggedDecisions(db, row.sessionId).find(decision => decision.id === decisionId) ?? null : null
}
