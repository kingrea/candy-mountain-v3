import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Monitor } from '@candy-mountain/shared'
import type { Db } from '../db'
import { onProjectArchiveChange } from '../projects/projects'
import { MONITOR_SOURCE_REGISTRY } from './builtin-sources'
import { latestMonitorCheckAt, recordMonitorCheck, type UptimeCheck } from './checks'
import { resolveUptimeSettings } from './config'
import { findPolledMonitor, listEnabledMonitors, onMonitorChange, runMonitorCheck } from './service'
import type { MonitorSourceRegistry } from './sources'

/** Monitors due at the same moment (a boot, a backlog) spread their first checks over at most this window. */
export const MONITOR_STAGGER_WINDOW_MS = 15_000

export interface UptimeSchedulerDeps {
  db: Db
  /** Usually the data directory; starting a second scheduler with the same key in this process closes the first. */
  key?: string
  /** Holds the newest scheduler's token, so an older process still winding down stops polling at its next tick. */
  ownerFile?: string
  sources?: MonitorSourceRegistry
  fetch?: typeof globalThis.fetch
  log?: Pick<Console, 'warn' | 'error'>
}

export interface UptimeSchedulerOptions {
  historyMax?: number
  historyMaxAgeMs?: number
  /** Per-check timeout passed to the checkers. */
  timeoutMs?: number
  staggerWindowMs?: number
}

export interface UptimeCheckEvent {
  monitor: Monitor
  check: UptimeCheck
}

export type UptimeCheckListener = (event: UptimeCheckEvent) => void | Promise<void>

export interface UptimeScheduler {
  /** Ids of the monitors that currently have a schedule. */
  scheduled(): string[]
  /** ISO time of the monitor's next check, or null when it has no schedule. */
  nextCheckAt(monitorId: string): string | null
  /** Called after each check is stored, in the order checks finish. */
  onCheck(listener: UptimeCheckListener): () => void
  /** Re-reads every enabled monitor, scheduling new ones and dropping the rest. */
  reload(): void
  close(): void
}

interface Entry {
  monitor: Monitor
  dueAt: number
  timer: NodeJS.Timeout | null
  running: AbortController | null
}

const defaults = resolveUptimeSettings({})
const schedulers = new Map<string, UptimeScheduler>()

export function startUptimeScheduler(
  { db, key, ownerFile, sources = MONITOR_SOURCE_REGISTRY, fetch, log = console }: UptimeSchedulerDeps,
  { historyMax = defaults.historyMax, historyMaxAgeMs = defaults.historyMaxAgeMs, timeoutMs, staggerWindowMs = MONITOR_STAGGER_WINDOW_MS }: UptimeSchedulerOptions = {},
): UptimeScheduler {
  if (key !== undefined) schedulers.get(key)?.close()

  const entries = new Map<string, Entry>()
  const listeners = new Set<UptimeCheckListener>()
  const token = randomUUID()
  let stopped = false

  if (ownerFile) writeFileSync(ownerFile, token, { mode: 0o600 })

  const ownsSchedule = () => {
    if (!ownerFile) return true
    try {
      return readFileSync(ownerFile, 'utf8') === token
    }
    catch {
      return false
    }
  }

  const intervalMs = (monitor: Monitor) => monitor.intervalSeconds * 1000

  const stagger = (monitor: Monitor) => {
    const window = Math.min(intervalMs(monitor), staggerWindowMs)
    return window > 0 ? createHash('sha1').update(monitor.id).digest().readUInt32BE(0) % window : 0
  }

  /** Keeps the cadence across restarts and interval edits by counting from the last stored check. */
  const firstDue = (monitor: Monitor, fresh: boolean) => {
    const now = Date.now()
    const last = fresh ? null : latestMonitorCheckAt(db, monitor.id)
    const due = last === null ? now : Date.parse(last) + intervalMs(monitor)
    return due > now ? due : now + stagger(monitor)
  }

  const arm = (entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => fire(entry), Math.max(0, entry.dueAt - Date.now()))
    entry.timer.unref()
  }

  const cancelRun = (entry: Entry) => {
    entry.running?.abort()
    entry.running = null
  }

  const unschedule = (monitorId: string) => {
    const entry = entries.get(monitorId)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    cancelRun(entry)
    entries.delete(monitorId)
  }

  const schedule = (monitor: Monitor) => {
    if (!monitor.enabled || !findPolledMonitor(db, monitor.id)) return unschedule(monitor.id)
    const entry = entries.get(monitor.id)
    if (!entry) {
      const created: Entry = { monitor, dueAt: firstDue(monitor, false), timer: null, running: null }
      entries.set(monitor.id, created)
      return arm(created)
    }
    const previous = entry.monitor
    entry.monitor = monitor
    const probeChanged = previous.sourceType !== monitor.sourceType || previous.target !== monitor.target
      || JSON.stringify(previous.options) !== JSON.stringify(monitor.options)
    if (probeChanged) {
      cancelRun(entry)
      entry.dueAt = firstDue(monitor, true)
      arm(entry)
    }
    else if (previous.intervalSeconds !== monitor.intervalSeconds) {
      entry.dueAt = firstDue(monitor, false)
      arm(entry)
    }
  }

  const notify = (event: UptimeCheckEvent) => {
    for (const listener of listeners) {
      try {
        void Promise.resolve(listener(event)).catch(error => log.error('Uptime check listener failed', error))
      }
      catch (error) {
        log.error('Uptime check listener failed', error)
      }
    }
  }

  const run = (entry: Entry, monitor: Monitor) => {
    const controller = new AbortController()
    entry.running = controller
    void runMonitorCheck(monitor, { sources, fetch, timeoutMs, signal: controller.signal }).then((result) => {
      if (entry.running === controller) entry.running = null
      // Our own abort means the monitor changed, went away or the scheduler closed; that verdict is not the target's.
      if (controller.signal.aborted || stopped) return
      let check: UptimeCheck
      try {
        check = recordMonitorCheck(db, monitor.id, result, { historyMax, historyMaxAgeMs })
      }
      catch (error) {
        log.error(`Could not store the check of monitor ${monitor.id}`, error)
        return
      }
      notify({ monitor, check })
    })
  }

  const fire = (entry: Entry) => {
    if (stopped || entries.get(entry.monitor.id) !== entry) return
    try {
      if (!ownsSchedule()) {
        log.warn('Another uptime scheduler took over this data directory; this one stops polling.')
        return halt()
      }
      const now = Date.now()
      do entry.dueAt += intervalMs(entry.monitor)
      while (entry.dueAt <= now)
      arm(entry)
      if (entry.running) return
      const current = findPolledMonitor(db, entry.monitor.id)
      if (!current) return unschedule(entry.monitor.id)
      if (current.intervalSeconds !== entry.monitor.intervalSeconds) {
        entry.dueAt = now + intervalMs(current)
        arm(entry)
      }
      entry.monitor = current
      run(entry, current)
    }
    catch (error) {
      log.error(`Uptime tick for monitor ${entry.monitor.id} failed`, error)
    }
  }

  const reload = () => {
    if (stopped) return
    const monitors = listEnabledMonitors(db)
    const ids = new Set(monitors.map(m => m.id))
    for (const id of [...entries.keys()]) if (!ids.has(id)) unschedule(id)
    for (const monitor of monitors) schedule(monitor)
  }

  const unsubscribeMonitors = onMonitorChange((changedDb, change) => {
    if (stopped || changedDb !== db) return
    if (change.kind === 'deleted') unschedule(change.monitorId)
    else schedule(change.monitor)
  })
  const unsubscribeArchive = onProjectArchiveChange((changedDb) => {
    if (changedDb === db) reload()
  })

  function halt() {
    stopped = true
    unsubscribeMonitors()
    unsubscribeArchive()
    for (const id of [...entries.keys()]) unschedule(id)
  }

  const scheduler: UptimeScheduler = {
    scheduled: () => [...entries.keys()],
    nextCheckAt: (monitorId) => {
      const entry = entries.get(monitorId)
      return entry ? new Date(entry.dueAt).toISOString() : null
    },
    onCheck(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reload,
    close() {
      if (key !== undefined && schedulers.get(key) === scheduler) schedulers.delete(key)
      if (stopped) return
      halt()
      if (ownerFile && ownsSchedule()) rmSync(ownerFile, { force: true })
    },
  }
  if (key !== undefined) schedulers.set(key, scheduler)
  reload()
  return scheduler
}
