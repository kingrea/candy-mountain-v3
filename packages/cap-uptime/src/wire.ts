import type { MonitorOptionField, MonitorOptions } from '@crab-shack/platform-sdk'

export const MONITOR_SOURCES_PATH = '/monitor-sources'
export const UPTIME_MANAGE_TOOL = 'uptime.manage'
export const workspaceMonitorsPath = (slug: string) => `/workspaces/${slug}/monitors`
export const workspaceMonitorPath = (slug: string, id: string) => `${workspaceMonitorsPath(slug)}/${id}`

export const MONITOR_INTERVAL_MIN_SECONDS = 30
export const MONITOR_INTERVAL_MAX_SECONDS = 86_400
export const MONITOR_INTERVAL_DEFAULT_SECONDS = 60
export const MONITOR_NAME_MAX_LENGTH = 100
export const MONITOR_TARGET_MAX_LENGTH = 2048

export const MONITOR_SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Wire-safe description of a monitor source type; the daemon's definition adds the checker. */
export interface MonitorSourceInfo {
  id: string
  label: string
  description: string
  /** What the monitor's target URL points at for this type. */
  targetLabel: string
  targetPlaceholder?: string
  fields: readonly MonitorOptionField[]
}

export function monitorSourceInfo(source: MonitorSourceInfo): MonitorSourceInfo {
  const { id, label, description, targetLabel, targetPlaceholder, fields } = source
  return { id, label, description, targetLabel, ...(targetPlaceholder === undefined ? {} : { targetPlaceholder }), fields }
}

export interface Monitor {
  id: string
  projectId: string
  name: string
  /** A registered monitor source id, such as 'http' or 'statuspage'. */
  sourceType: string
  target: string
  intervalSeconds: number
  enabled: boolean
  options: MonitorOptions
  createdAt: string
  updatedAt: string
}

export interface CreateMonitorRequest {
  name: string
  sourceType: string
  target: string
  intervalSeconds?: number
  enabled?: boolean
  options?: Record<string, unknown>
}

/** Omitted fields are unchanged; `options`, when sent, replaces the stored options whole. */
export type UpdateMonitorRequest = Partial<CreateMonitorRequest>

export interface MonitorListResponse {
  monitors: Monitor[]
}

export interface MonitorResponse {
  monitor: Monitor
}

export interface MonitorSourceListResponse {
  sources: MonitorSourceInfo[]
}

export const MONITOR_ERROR_CODES = ['invalid_request', 'not_found', 'unknown_source', 'invalid_options'] as const
export type MonitorErrorCode = (typeof MONITOR_ERROR_CODES)[number]

export const workspaceMonitorStatusPath = (slug: string, id: string) => `${workspaceMonitorPath(slug, id)}/status`
export const workspaceMonitorChecksPath = (slug: string, id: string) => `${workspaceMonitorPath(slug, id)}/checks`
export const workspaceMonitorIncidentsPath = (slug: string, id: string) => `${workspaceMonitorPath(slug, id)}/incidents`
export const workspaceUptimeStatusPath = (slug: string) => `/workspaces/${slug}/uptime/status`
export const workspaceUptimeIncidentsPath = (slug: string) => `/workspaces/${slug}/uptime/incidents`

/** In-app link to a monitor on the Uptime page; the page opens that monitor's drawer from `?monitor=`. */
export const uptimeMonitorLink = (prefix: string, slug: string, monitorId: string) => `/${prefix}/${slug}/uptime?monitor=${encodeURIComponent(monitorId)}`

/** A monitor is down only when this many newest checks all failed. */
export const MONITOR_DOWN_THRESHOLD = 3
export const MONITOR_SLOW_LATENCY_MS = 2000

export const MONITOR_CHECKS_DEFAULT_LIMIT = 50
export const MONITOR_CHECKS_MAX_LIMIT = 1000
export const MONITOR_STATUS_RECENT_DEFAULT = 30
export const MONITOR_STATUS_RECENT_MAX = 200
export const INCIDENTS_DEFAULT_LIMIT = 50
export const INCIDENTS_MAX_LIMIT = 200

/** One check's own verdict, before any hysteresis. */
export type MonitorCheckStatus = 'up' | 'degraded' | 'down'

export const MONITOR_STATES = ['up', 'degraded', 'down', 'unknown'] as const
export type MonitorState = (typeof MONITOR_STATES)[number]

export interface MonitorCheckRecord {
  id: number
  monitorId: string
  checkedAt: string
  ok: boolean
  status: MonitorCheckStatus
  httpStatus: number | null
  latencyMs: number
  detail: string | null
}

export interface MonitorIncident {
  id: string
  projectId: string
  monitorId: string
  openedAt: string
  /** Null while the incident is open. */
  closedAt: string | null
  reason: string
  /** A chat thread investigating the incident; nothing sets it automatically. */
  threadId: string | null
}

export interface MonitorStatus {
  monitor: Monitor
  state: MonitorState
  lastCheck: MonitorCheckRecord | null
  openIncident: MonitorIncident | null
  /** Newest first; as many as the request's `recent` asked for. */
  recentChecks: MonitorCheckRecord[]
}

export interface MonitorStatusResponse {
  status: MonitorStatus
}

export interface UptimeStatusResponse {
  monitors: MonitorStatus[]
}

export interface MonitorCheckListResponse {
  checks: MonitorCheckRecord[]
}

export const INCIDENT_STATUS_FILTERS = ['open', 'closed'] as const
export type IncidentStatusFilter = (typeof INCIDENT_STATUS_FILTERS)[number]

export interface IncidentListResponse {
  incidents: MonitorIncident[]
}
