import type { Db } from '../db'
import type { UptimeScheduler } from './scheduler'
import { listEnabledMonitors } from './service'
import { reconcileMonitorIncident } from './state'

export interface IncidentTrackerDeps {
  db: Db
  scheduler: Pick<UptimeScheduler, 'onCheck'>
  log?: Pick<Console, 'error'>
}

export interface IncidentTracker {
  close(): void
}

/** Also reconciles at start, settling a transition a crash left half done. */
export function startIncidentTracker({ db, scheduler, log = console }: IncidentTrackerDeps): IncidentTracker {
  const unsubscribe = scheduler.onCheck(({ monitor }) => void reconcileMonitorIncident(db, monitor))
  for (const monitor of listEnabledMonitors(db)) {
    try {
      reconcileMonitorIncident(db, monitor)
    }
    catch (error) {
      log.error(`Could not reconcile the incident of monitor ${monitor.id}`, error)
    }
  }
  return { close: unsubscribe }
}
