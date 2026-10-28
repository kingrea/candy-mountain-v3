import { MONITOR_DOWN_THRESHOLD, MONITOR_SLOW_LATENCY_MS, type Monitor, type MonitorState, type MonitorStatus } from '@candy-mountain/shared'
import type { Db } from '../db'
import { listMonitorChecks, type UptimeCheck } from './checks'
import { closeIncident, findOpenIncident, openIncident } from './incidents'

export interface MonitorStateOptions {
  downThreshold?: number
  slowLatencyMs?: number
}

/** Checks newest first; degraded shares the down window, so recovery reads degraded until three good checks in a row. */
export function deriveMonitorState(
  checks: readonly Pick<UptimeCheck, 'status' | 'latencyMs'>[],
  { downThreshold = MONITOR_DOWN_THRESHOLD, slowLatencyMs = MONITOR_SLOW_LATENCY_MS }: MonitorStateOptions = {},
): MonitorState {
  if (checks.length === 0) return 'unknown'
  const window = checks.slice(0, downThreshold)
  if (window.length >= downThreshold && window.every(c => c.status === 'down')) return 'down'
  if (window.some(c => c.status !== 'up' || c.latencyMs > slowLatencyMs)) return 'degraded'
  return 'up'
}

export function monitorStatus(db: Db, monitor: Monitor, recent: number): MonitorStatus {
  const checks = listMonitorChecks(db, monitor.id, Math.max(recent, MONITOR_DOWN_THRESHOLD))
  return {
    monitor,
    state: deriveMonitorState(checks),
    lastCheck: checks[0] ?? null,
    openIncident: findOpenIncident(db, monitor.id),
    recentChecks: checks.slice(0, recent),
  }
}

/** Compares with the stored incident rather than a remembered previous state, so a restart never opens a second one. */
export function reconcileMonitorIncident(db: Db, monitor: Monitor): MonitorState {
  const checks = listMonitorChecks(db, monitor.id, MONITOR_DOWN_THRESHOLD)
  const state = deriveMonitorState(checks)
  const newest = checks[0]
  if (!newest || (state !== 'down' && state !== 'up')) return state
  const open = findOpenIncident(db, monitor.id)
  if (state === 'down' && !open) {
    openIncident(db, monitor, { reason: newest.detail ?? `The last ${MONITOR_DOWN_THRESHOLD} checks failed.`, openedAt: newest.checkedAt })
  }
  if (state === 'up' && open) closeIncident(db, monitor, open.id, newest.checkedAt)
  return state
}
