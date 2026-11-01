import { join } from 'node:path'
import { MONITOR_SOURCES_PATH } from '@candy-mountain/shared'
import { defineCapabilityDefinition, type CapabilityDefinition, type CapabilityRuntime } from '../capabilities/definition'
import { MONITOR_SOURCE_REGISTRY } from './builtin-sources'
import { uptimeCapability } from './manifest'
import { monitorRoutes, monitorSourceRoutes } from './routes'
import { startUptimeScheduler, type UptimeSchedulerOptions } from './scheduler'
import type { MonitorSourceRegistry } from './sources'
import { startIncidentTracker } from './tracker'

/** The routes without the scheduler, for an app that only needs them answered. */
export function uptimeRoutes(sources: MonitorSourceRegistry = MONITOR_SOURCE_REGISTRY): Pick<CapabilityRuntime, 'workspaceRoutes' | 'platformRoutes'> {
  return {
    workspaceRoutes: [monitorRoutes(sources)],
    platformRoutes: [{ path: MONITOR_SOURCES_PATH, routes: monitorSourceRoutes(sources) }],
  }
}

export function uptimeDefinition(options: UptimeSchedulerOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: uptimeCapability.id,
    manifest: uptimeCapability,
    start({ db, paths, scopeUrlPrefix }) {
      const scheduler = startUptimeScheduler({ db, key: paths.root, ownerFile: join(paths.run, 'uptime-scheduler.owner') }, options)
      const incidents = startIncidentTracker({ db, scheduler, scopeUrlPrefix })
      return {
        ...uptimeRoutes(),
        close() {
          incidents.close()
          scheduler.close()
        },
      }
    },
  })
}
