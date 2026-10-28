import { and, desc, eq, lt, lte, or } from 'drizzle-orm'
import type { Db } from '../db'
import { uptimeChecks } from '../db/schema'
import type { MonitorCheckResult } from './check'

export const MONITOR_CHECKS_LIST_DEFAULT = 50
export const MONITOR_CHECKS_LIST_MAX = 1000

/** One stored check of a monitor. */
export type UptimeCheck = typeof uptimeChecks.$inferSelect

export interface CheckRetention {
  historyMax: number
  historyMaxAgeMs: number
}

/** Stores a check and prunes that monitor's history beyond the retention in the same transaction. */
export function recordMonitorCheck(db: Db, monitorId: string, result: MonitorCheckResult, retention: CheckRetention, now = new Date()): UptimeCheck {
  return db.transaction((tx) => {
    const { ok, status, httpStatus, latencyMs, detail, checkedAt } = result
    const check = tx.insert(uptimeChecks).values({ monitorId, checkedAt, ok, status, httpStatus, latencyMs, detail }).returning().get()
    pruneMonitorChecks(tx, monitorId, retention, now)
    return check
  })
}

export function pruneMonitorChecks(db: Db, monitorId: string, { historyMax, historyMaxAgeMs }: CheckRetention, now = new Date()): void {
  const cutoff = new Date(now.getTime() - historyMaxAgeMs).toISOString()
  const ofMonitor = eq(uptimeChecks.monitorId, monitorId)
  const boundary = db.select({ id: uptimeChecks.id, checkedAt: uptimeChecks.checkedAt }).from(uptimeChecks).where(ofMonitor)
    .orderBy(desc(uptimeChecks.checkedAt), desc(uptimeChecks.id)).limit(1).offset(historyMax).get()
  const beyondCount = boundary
    ? or(lt(uptimeChecks.checkedAt, boundary.checkedAt), and(eq(uptimeChecks.checkedAt, boundary.checkedAt), lte(uptimeChecks.id, boundary.id)))
    : undefined
  db.delete(uptimeChecks).where(and(ofMonitor, or(lt(uptimeChecks.checkedAt, cutoff), beyondCount))).run()
}

/** A monitor's stored checks, newest first. */
export function listMonitorChecks(db: Db, monitorId: string, limit = MONITOR_CHECKS_LIST_DEFAULT): UptimeCheck[] {
  const capped = Math.min(Math.max(Math.trunc(limit) || 1, 1), MONITOR_CHECKS_LIST_MAX)
  return db.select().from(uptimeChecks).where(eq(uptimeChecks.monitorId, monitorId))
    .orderBy(desc(uptimeChecks.checkedAt), desc(uptimeChecks.id)).limit(capped).all()
}

export function latestMonitorCheckAt(db: Db, monitorId: string): string | null {
  return db.select({ checkedAt: uptimeChecks.checkedAt }).from(uptimeChecks).where(eq(uptimeChecks.monitorId, monitorId))
    .orderBy(desc(uptimeChecks.checkedAt), desc(uptimeChecks.id)).limit(1).get()?.checkedAt ?? null
}
