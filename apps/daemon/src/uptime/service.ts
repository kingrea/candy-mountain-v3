import { randomUUID } from 'node:crypto'
import {
  MONITOR_INTERVAL_DEFAULT_SECONDS, validateMonitorOptions,
  type CreateMonitorRequest, type Monitor, type MonitorOptions, type UpdateMonitorRequest,
} from '@candy-mountain/shared'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { projects, uptimeMonitors } from '../db/schema'
import { MONITOR_SOURCE_REGISTRY } from './builtin-sources'
import type { MonitorCheckResult } from './check'
import { MonitorError } from './errors'
import type { MonitorSource, MonitorSourceRegistry } from './sources'

type Row = typeof uptimeMonitors.$inferSelect

const toMonitor = (row: Row): Monitor => ({ ...row })

export type MonitorChange = { kind: 'saved', monitor: Monitor } | { kind: 'deleted', monitorId: string }
export type MonitorChangeListener = (db: Db, change: MonitorChange) => void

const changeListeners = new Set<MonitorChangeListener>()

/** Called after every monitor write made through this service, with the database it was written to. */
export function onMonitorChange(listener: MonitorChangeListener): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function emitMonitorChange(db: Db, change: MonitorChange): void {
  for (const listener of changeListeners) {
    try {
      listener(db, change)
    }
    catch (error) {
      console.error('Monitor change listener failed', error)
    }
  }
}

export function monitorSourceOf(sources: MonitorSourceRegistry, id: string): MonitorSource {
  const source = sources.byId(id)
  if (!source) throw new MonitorError('unknown_source', `Unknown monitor source "${id}"; known sources are ${sources.ids().join(', ')}`)
  return source
}

function validOptions(source: MonitorSource, input: unknown): MonitorOptions {
  const result = validateMonitorOptions(source.fields, input)
  if (!result.ok) {
    throw new MonitorError('invalid_options', result.errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' '))
  }
  return result.options
}

export function listMonitors(db: Db, projectId: string): Monitor[] {
  return db.select().from(uptimeMonitors).where(eq(uptimeMonitors.projectId, projectId))
    .orderBy(asc(sql`lower(${uptimeMonitors.name})`), asc(uptimeMonitors.createdAt)).all().map(toMonitor)
}

const polled = and(eq(uptimeMonitors.enabled, true), isNull(projects.archivedAt))

/** Every monitor that should be polled: enabled, in a project that is not archived (archiving pauses its monitors). */
export function listEnabledMonitors(db: Db): Monitor[] {
  return db.select({ monitor: uptimeMonitors }).from(uptimeMonitors).innerJoin(projects, eq(projects.id, uptimeMonitors.projectId))
    .where(polled).orderBy(asc(uptimeMonitors.createdAt)).all().map(row => toMonitor(row.monitor))
}

/** The monitor if it should be polled, by the same rule as listEnabledMonitors. */
export function findPolledMonitor(db: Db, id: string): Monitor | null {
  const row = db.select({ monitor: uptimeMonitors }).from(uptimeMonitors).innerJoin(projects, eq(projects.id, uptimeMonitors.projectId))
    .where(and(eq(uptimeMonitors.id, id), polled)).get()
  return row ? toMonitor(row.monitor) : null
}

export function findMonitor(db: Db, projectId: string, id: string): Monitor | null {
  const row = db.select().from(uptimeMonitors).where(and(eq(uptimeMonitors.projectId, projectId), eq(uptimeMonitors.id, id))).get()
  return row ? toMonitor(row) : null
}

export function getMonitor(db: Db, projectId: string, id: string): Monitor {
  const monitor = findMonitor(db, projectId, id)
  if (!monitor) throw new MonitorError('not_found', `No monitor with id "${id}" in this project`)
  return monitor
}

export function createMonitor(db: Db, projectId: string, input: CreateMonitorRequest, sources: MonitorSourceRegistry = MONITOR_SOURCE_REGISTRY): Monitor {
  const source = monitorSourceOf(sources, input.sourceType)
  const now = new Date().toISOString()
  const row: Row = {
    id: randomUUID(),
    projectId,
    name: input.name,
    sourceType: source.id,
    target: input.target,
    intervalSeconds: input.intervalSeconds ?? MONITOR_INTERVAL_DEFAULT_SECONDS,
    enabled: input.enabled ?? true,
    options: validOptions(source, input.options ?? {}),
    createdAt: now,
    updatedAt: now,
  }
  db.insert(uptimeMonitors).values(row).run()
  const monitor = toMonitor(row)
  emitMonitorChange(db, { kind: 'saved', monitor })
  return monitor
}

/** A changed source type without new options is validated against an empty object, so its defaults apply. */
export function updateMonitor(db: Db, projectId: string, id: string, input: UpdateMonitorRequest, sources: MonitorSourceRegistry = MONITOR_SOURCE_REGISTRY): Monitor {
  const monitor = db.transaction((tx) => {
    const current = getMonitor(tx, projectId, id)
    const sourceType = input.sourceType ?? current.sourceType
    const sourceChanged = sourceType !== current.sourceType
    const options = input.options !== undefined || sourceChanged
      ? validOptions(monitorSourceOf(sources, sourceType), input.options ?? {})
      : current.options
    const next: Monitor = {
      ...current,
      name: input.name ?? current.name,
      sourceType,
      target: input.target ?? current.target,
      intervalSeconds: input.intervalSeconds ?? current.intervalSeconds,
      enabled: input.enabled ?? current.enabled,
      options,
      updatedAt: new Date().toISOString(),
    }
    const { name, target, intervalSeconds, enabled, updatedAt } = next
    tx.update(uptimeMonitors).set({ name, sourceType, target, intervalSeconds, enabled, options, updatedAt }).where(eq(uptimeMonitors.id, id)).run()
    return next
  })
  emitMonitorChange(db, { kind: 'saved', monitor })
  return monitor
}

export function setMonitorEnabled(db: Db, projectId: string, id: string, enabled: boolean): Monitor {
  return updateMonitor(db, projectId, id, { enabled })
}

export function deleteMonitor(db: Db, projectId: string, id: string): void {
  getMonitor(db, projectId, id)
  db.delete(uptimeMonitors).where(eq(uptimeMonitors.id, id)).run()
  emitMonitorChange(db, { kind: 'deleted', monitorId: id })
}

export interface RunMonitorCheckOptions {
  sources?: MonitorSourceRegistry
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

/** Runs one check now; never rejects, so an unknown type or a checker that throws comes back down. */
export async function runMonitorCheck(monitor: Pick<Monitor, 'sourceType' | 'target' | 'options'>, options: RunMonitorCheckOptions = {}): Promise<MonitorCheckResult> {
  const { sources = MONITOR_SOURCE_REGISTRY, ...context } = options
  const checkedAt = new Date().toISOString()
  const failed = (detail: string): MonitorCheckResult => ({ ok: false, status: 'down', httpStatus: null, detail, latencyMs: 0, checkedAt })
  const source = sources.byId(monitor.sourceType)
  if (!source) return failed(`Unknown monitor source "${monitor.sourceType}".`)
  try {
    return await source.check({ target: monitor.target, options: monitor.options, ...context })
  }
  catch {
    return failed(`The ${source.label} checker failed unexpectedly.`)
  }
}
