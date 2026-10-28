import { randomUUID } from 'node:crypto'
import {
  INCIDENTS_DEFAULT_LIMIT, INCIDENTS_MAX_LIMIT, uptimeMonitorLink,
  type IncidentStatusFilter, type Monitor, type MonitorIncident,
} from '@candy-mountain/shared'
import { and, desc, eq, isNotNull, isNull, type SQL } from 'drizzle-orm'
import { appendActivityEvent } from '../activity'
import type { Db } from '../db'
import { uptimeIncidents } from '../db/schema'
import { findProjectById } from '../projects/projects'

export interface ListIncidentsOptions {
  status?: IncidentStatusFilter
  limit?: number
  monitorId?: string
}

export interface OpenIncidentInput {
  reason: string
  openedAt: string
}

const toIncident = (row: typeof uptimeIncidents.$inferSelect): MonitorIncident => ({ ...row })

export function findOpenIncident(db: Db, monitorId: string): MonitorIncident | null {
  const row = db.select().from(uptimeIncidents).where(and(eq(uptimeIncidents.monitorId, monitorId), isNull(uptimeIncidents.closedAt))).get()
  return row ? toIncident(row) : null
}

/** Newest first, for one project and optionally one of its monitors. */
export function listIncidents(db: Db, projectId: string, { status, limit = INCIDENTS_DEFAULT_LIMIT, monitorId }: ListIncidentsOptions = {}): MonitorIncident[] {
  const filters: SQL[] = [eq(uptimeIncidents.projectId, projectId)]
  if (monitorId !== undefined) filters.push(eq(uptimeIncidents.monitorId, monitorId))
  if (status === 'open') filters.push(isNull(uptimeIncidents.closedAt))
  if (status === 'closed') filters.push(isNotNull(uptimeIncidents.closedAt))
  const capped = Math.min(Math.max(Math.trunc(limit) || 1, 1), INCIDENTS_MAX_LIMIT)
  return db.select().from(uptimeIncidents).where(and(...filters))
    .orderBy(desc(uptimeIncidents.openedAt), desc(uptimeIncidents.id)).limit(capped).all().map(toIncident)
}

function monitorLink(db: Db, monitor: Monitor): string | undefined {
  const project = findProjectById(db, monitor.projectId)
  return project ? uptimeMonitorLink(project.slug, monitor.id) : undefined
}

/** Opens the monitor's incident and records incident.opened; an already open incident is returned instead. */
export function openIncident(db: Db, monitor: Monitor, { reason, openedAt }: OpenIncidentInput): { incident: MonitorIncident, created: boolean } {
  const row = { id: randomUUID(), projectId: monitor.projectId, monitorId: monitor.id, openedAt, closedAt: null, reason, threadId: null }
  // The partial unique index keeps one open incident per monitor even if two daemons share the database.
  const inserted = db.insert(uptimeIncidents).values(row).onConflictDoNothing().returning().get()
  if (!inserted) return { incident: findOpenIncident(db, monitor.id)!, created: false }
  const incident = toIncident(inserted)
  appendActivityEvent(db, {
    projectId: monitor.projectId,
    type: 'incident.opened',
    title: `${monitor.name} is down: ${reason}`,
    link: monitorLink(db, monitor),
    payload: { incidentId: incident.id, monitorId: monitor.id, monitorName: monitor.name, reason, openedAt },
  })
  return { incident, created: true }
}

/** Closes an open incident and records incident.closed; null when it was already closed. */
export function closeIncident(db: Db, monitor: Monitor, incidentId: string, closedAt: string): MonitorIncident | null {
  const updated = db.update(uptimeIncidents).set({ closedAt })
    .where(and(eq(uptimeIncidents.id, incidentId), isNull(uptimeIncidents.closedAt))).returning().get()
  if (!updated) return null
  const incident = toIncident(updated)
  appendActivityEvent(db, {
    projectId: monitor.projectId,
    type: 'incident.closed',
    title: `${monitor.name} is back up`,
    link: monitorLink(db, monitor),
    payload: {
      incidentId: incident.id,
      monitorId: monitor.id,
      monitorName: monitor.name,
      openedAt: incident.openedAt,
      closedAt,
      durationMs: Math.max(0, Date.parse(closedAt) - Date.parse(incident.openedAt)),
    },
  })
  return incident
}

export function setIncidentThread(db: Db, incidentId: string, threadId: string | null): MonitorIncident | null {
  const updated = db.update(uptimeIncidents).set({ threadId }).where(eq(uptimeIncidents.id, incidentId)).returning().get()
  return updated ? toIncident(updated) : null
}
