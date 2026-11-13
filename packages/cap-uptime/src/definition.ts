import { join } from 'node:path'
import { MONITOR_SOURCES_PATH } from './wire'
import { defineCapabilityDefinition, type ActivityEventTypeDeclaration, type CapabilityDefinition, type CapabilityRuntime } from '@crab-shack/platform-sdk/daemon'
import { MONITOR_SOURCE_REGISTRY } from './builtin-sources'
import { resolveUptimeSettings } from './config'
import { uptimeCapability } from './manifest'
import { monitorRoutes, monitorSourceRoutes } from './routes'
import { startUptimeScheduler, type UptimeSchedulerOptions } from './scheduler'
import type { MonitorSourceRegistry } from './sources'
import { startIncidentTracker } from './tracker'
import { srcPath } from './package-root'
import * as uptimeSchema from './schema'

/** Appended by the incident tracker. */
export const UPTIME_ACTIVITY_EVENT_TYPES: readonly ActivityEventTypeDeclaration[] = [
  { id: 'incident.opened', label: 'Incident opened', icon: 'i-lucide-triangle-alert', notifications: [{ id: 'incident.opened', label: 'An incident opens' }] },
  { id: 'incident.closed', label: 'Incident closed', icon: 'i-lucide-circle-check', notifications: [{ id: 'incident.closed', label: 'An incident closes' }] },
]

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
    package: '@candy-mountain/cap-uptime',
    sdkMajor: 0,
    manifest: uptimeCapability,
    schema: { schema: uptimeSchema, migrationsFolder: srcPath('migrations') },
    activityEventTypes: UPTIME_ACTIVITY_EVENT_TYPES,
    start({ db, paths, scopeUrlPrefix }) {
      // History bounds come from CM_UPTIME_* here so a distribution needs no uptime lines of its own beyond listing the definition.
      const settings = resolveUptimeSettings()
      const scheduler = startUptimeScheduler({ db, key: paths.root, ownerFile: join(paths.run, 'uptime-scheduler.owner') }, { historyMax: settings.historyMax, historyMaxAgeMs: settings.historyMaxAgeMs, ...options })
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
