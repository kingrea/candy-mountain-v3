export const MONITOR_SOURCES_PATH = '/monitor-sources'
export const UPTIME_MANAGE_TOOL = 'uptime.manage'
export const projectMonitorsPath = (slug: string) => `/projects/${slug}/monitors`
export const projectMonitorPath = (slug: string, id: string) => `${projectMonitorsPath(slug)}/${id}`

export const MONITOR_INTERVAL_MIN_SECONDS = 30
export const MONITOR_INTERVAL_MAX_SECONDS = 86_400
export const MONITOR_INTERVAL_DEFAULT_SECONDS = 60
export const MONITOR_NAME_MAX_LENGTH = 100
export const MONITOR_TARGET_MAX_LENGTH = 2048

export const MONITOR_SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/
export const MONITOR_OPTION_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/

interface MonitorOptionFieldBase {
  name: string
  label: string
  description?: string
  /** A required field with no default must be supplied. */
  required?: boolean
}

export interface MonitorStringField extends MonitorOptionFieldBase {
  kind: 'string'
  placeholder?: string
  /** RegExp source the trimmed value must match in full. */
  pattern?: string
  maxLength?: number
  default?: string
}

export interface MonitorIntegerField extends MonitorOptionFieldBase {
  kind: 'integer'
  placeholder?: string
  min?: number
  max?: number
  default?: number
}

export type MonitorOptionField = MonitorStringField | MonitorIntegerField
export type MonitorOptionFieldKind = MonitorOptionField['kind']
export const MONITOR_OPTION_FIELD_KINDS: readonly MonitorOptionFieldKind[] = ['string', 'integer']

export type MonitorOptionValue = string | number
export type MonitorOptions = Record<string, MonitorOptionValue>

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

export interface MonitorOptionError {
  field: string
  message: string
}

export type MonitorOptionsResult = { ok: true, options: MonitorOptions } | { ok: false, errors: MonitorOptionError[] }

/** Strings are trimmed and an empty string counts as absent; integers may arrive as digit strings from forms; unknown keys are rejected. */
export function validateMonitorOptions(fields: readonly MonitorOptionField[], input: unknown): MonitorOptionsResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ field: '', message: 'Options must be an object.' }] }
  }
  const values = input as Record<string, unknown>
  const errors: MonitorOptionError[] = []
  const options: MonitorOptions = {}

  for (const key of Object.keys(values)) {
    if (!fields.some(f => f.name === key)) errors.push({ field: key, message: 'Unknown option.' })
  }

  for (const field of fields) {
    let value = values[field.name]
    if (typeof value === 'string') value = value.trim()
    if (value === undefined || value === null || value === '') {
      if (field.default !== undefined) options[field.name] = field.default
      else if (field.required) errors.push({ field: field.name, message: `${field.label} is required.` })
      continue
    }
    const result = field.kind === 'string' ? stringValue(field, value) : integerValue(field, value)
    if (typeof result === 'object') errors.push({ field: field.name, message: result.error })
    else options[field.name] = result
  }

  return errors.length ? { ok: false, errors } : { ok: true, options }
}

function stringValue(field: MonitorStringField, value: unknown): string | { error: string } {
  if (typeof value !== 'string') return { error: `${field.label} must be text.` }
  if (field.maxLength !== undefined && value.length > field.maxLength) return { error: `${field.label} must be at most ${field.maxLength} characters.` }
  if (field.pattern !== undefined && !new RegExp(`^(?:${field.pattern})$`).test(value)) return { error: `${field.label} is not in the expected format.` }
  return value
}

function integerValue(field: MonitorIntegerField, value: unknown): number | { error: string } {
  const number = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) return { error: `${field.label} must be a whole number.` }
  if (field.min !== undefined && number < field.min) return { error: `${field.label} must be at least ${field.min}.` }
  if (field.max !== undefined && number > field.max) return { error: `${field.label} must be at most ${field.max}.` }
  return number
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

export const projectMonitorStatusPath = (slug: string, id: string) => `${projectMonitorPath(slug, id)}/status`
export const projectMonitorChecksPath = (slug: string, id: string) => `${projectMonitorPath(slug, id)}/checks`
export const projectMonitorIncidentsPath = (slug: string, id: string) => `${projectMonitorPath(slug, id)}/incidents`
export const projectUptimeStatusPath = (slug: string) => `/projects/${slug}/uptime/status`
export const projectUptimeIncidentsPath = (slug: string) => `/projects/${slug}/uptime/incidents`

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
