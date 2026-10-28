import {
  INCIDENT_STATUS_FILTERS, INCIDENTS_DEFAULT_LIMIT, INCIDENTS_MAX_LIMIT, MONITOR_CHECKS_DEFAULT_LIMIT, MONITOR_CHECKS_MAX_LIMIT,
  MONITOR_STATUS_RECENT_DEFAULT, MONITOR_STATUS_RECENT_MAX, monitorSourceInfo, UPTIME_MANAGE_TOOL,
  type ApiErrorBody, type IncidentListResponse, type IncidentStatusFilter, type MonitorCheckListResponse, type MonitorListResponse,
  type MonitorResponse, type MonitorSourceListResponse, type MonitorStatusResponse, type UptimeStatusResponse,
} from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { requireCapability } from '../registry/gate'
import { MONITOR_SOURCE_REGISTRY } from './builtin-sources'
import { listMonitorChecks } from './checks'
import { MonitorError } from './errors'
import { listIncidents } from './incidents'
import { createMonitor, deleteMonitor, getMonitor, listMonitors, setMonitorEnabled, updateMonitor } from './service'
import type { MonitorSourceRegistry } from './sources'
import { monitorStatus } from './state'
import { parseCreateMonitor, parseUpdateMonitor } from './validation'

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  }
  catch {
    throw new MonitorError('invalid_request', 'Request body must be valid JSON')
  }
}

function intQuery(c: Context, name: string, fallback: number, min: number, max: number): number {
  const raw = c.req.query(name)
  if (raw === undefined) return fallback
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new MonitorError('invalid_request', `${name} must be a whole number from ${min} to ${max}`)
  }
  return value
}

function incidentStatusQuery(c: Context): IncidentStatusFilter | undefined {
  const raw = c.req.query('status')
  if (raw === undefined) return undefined
  if (!(INCIDENT_STATUS_FILTERS as readonly string[]).includes(raw)) {
    throw new MonitorError('invalid_request', `status must be one of ${INCIDENT_STATUS_FILTERS.join(', ')}`)
  }
  return raw as IncidentStatusFilter
}

const recentQuery = (c: Context) => intQuery(c, 'recent', MONITOR_STATUS_RECENT_DEFAULT, 0, MONITOR_STATUS_RECENT_MAX)
const incidentLimitQuery = (c: Context) => intQuery(c, 'limit', INCIDENTS_DEFAULT_LIMIT, 1, INCIDENTS_MAX_LIMIT)

/** Reads need the uptime view; writes need the manage tool and, whatever the rung says, the admin. */
export function monitorRoutes(sources: MonitorSourceRegistry = MONITOR_SOURCE_REGISTRY) {
  const app = new Hono<AppEnv>()
  const read = requireCapability({ capability: 'uptime', view: 'uptime' })
  const admin = requireAdmin()
  const manage = requireCapability({ capability: 'uptime', tool: UPTIME_MANAGE_TOOL })
  app.onError((error, c) => {
    if (error instanceof MonitorError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  const projectIdOf = (c: Context<AppEnv>) => getProjectBySlug(c.var.db, c.req.param('slug')!).id

  app.get('/:slug/monitors', read, c => c.json<MonitorListResponse>({ monitors: listMonitors(c.var.db, projectIdOf(c)) }))

  app.post('/:slug/monitors', admin, manage, async (c) => {
    const projectId = projectIdOf(c)
    const monitor = createMonitor(c.var.db, projectId, parseCreateMonitor(await readJson(c)), sources)
    return c.json<MonitorResponse>({ monitor }, 201)
  })

  app.get('/:slug/monitors/:id', read, c =>
    c.json<MonitorResponse>({ monitor: getMonitor(c.var.db, projectIdOf(c), c.req.param('id')) }),
  )

  app.get('/:slug/monitors/:id/status', read, (c) => {
    const monitor = getMonitor(c.var.db, projectIdOf(c), c.req.param('id'))
    return c.json<MonitorStatusResponse>({ status: monitorStatus(c.var.db, monitor, recentQuery(c)) })
  })

  app.get('/:slug/monitors/:id/checks', read, (c) => {
    const monitor = getMonitor(c.var.db, projectIdOf(c), c.req.param('id'))
    const limit = intQuery(c, 'limit', MONITOR_CHECKS_DEFAULT_LIMIT, 1, MONITOR_CHECKS_MAX_LIMIT)
    return c.json<MonitorCheckListResponse>({ checks: listMonitorChecks(c.var.db, monitor.id, limit) })
  })

  app.get('/:slug/monitors/:id/incidents', read, (c) => {
    const monitor = getMonitor(c.var.db, projectIdOf(c), c.req.param('id'))
    const incidents = listIncidents(c.var.db, monitor.projectId, { monitorId: monitor.id, status: incidentStatusQuery(c), limit: incidentLimitQuery(c) })
    return c.json<IncidentListResponse>({ incidents })
  })

  app.get('/:slug/uptime/status', read, (c) => {
    const projectId = projectIdOf(c)
    const recent = recentQuery(c)
    return c.json<UptimeStatusResponse>({ monitors: listMonitors(c.var.db, projectId).map(monitor => monitorStatus(c.var.db, monitor, recent)) })
  })

  app.get('/:slug/uptime/incidents', read, (c) => {
    const projectId = projectIdOf(c)
    const monitorId = c.req.query('monitor')
    if (monitorId !== undefined) getMonitor(c.var.db, projectId, monitorId)
    const incidents = listIncidents(c.var.db, projectId, { monitorId, status: incidentStatusQuery(c), limit: incidentLimitQuery(c) })
    return c.json<IncidentListResponse>({ incidents })
  })

  app.patch('/:slug/monitors/:id', admin, manage, async (c) => {
    const projectId = projectIdOf(c)
    const monitor = updateMonitor(c.var.db, projectId, c.req.param('id'), parseUpdateMonitor(await readJson(c)), sources)
    return c.json<MonitorResponse>({ monitor })
  })

  app.post('/:slug/monitors/:id/enable', admin, manage, c =>
    c.json<MonitorResponse>({ monitor: setMonitorEnabled(c.var.db, projectIdOf(c), c.req.param('id'), true) }),
  )

  app.post('/:slug/monitors/:id/disable', admin, manage, c =>
    c.json<MonitorResponse>({ monitor: setMonitorEnabled(c.var.db, projectIdOf(c), c.req.param('id'), false) }),
  )

  app.delete('/:slug/monitors/:id', admin, manage, (c) => {
    deleteMonitor(c.var.db, projectIdOf(c), c.req.param('id'))
    return c.body(null, 204)
  })

  return app
}

export function monitorSourceRoutes(sources: MonitorSourceRegistry = MONITOR_SOURCE_REGISTRY) {
  const app = new Hono<AppEnv>()
  app.get('/', c => c.json<MonitorSourceListResponse>({ sources: sources.list().map(monitorSourceInfo) }))
  return app
}
