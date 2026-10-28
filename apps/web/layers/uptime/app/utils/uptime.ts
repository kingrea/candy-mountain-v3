import {
  MONITOR_INTERVAL_DEFAULT_SECONDS,
  MONITOR_INTERVAL_MAX_SECONDS,
  MONITOR_INTERVAL_MIN_SECONDS,
  MONITOR_NAME_MAX_LENGTH,
  MONITOR_TARGET_MAX_LENGTH,
  validateMonitorOptions,
  type CreateMonitorRequest,
  type Monitor,
  type MonitorCheckRecord,
  type MonitorIncident,
  type MonitorOptionError,
  type MonitorOptionField,
  type MonitorOptions,
  type MonitorSourceInfo,
  type MonitorState,
  type MonitorStatus,
  type UpdateMonitorRequest,
} from '@candy-mountain/shared'

export const UPTIME_SOURCES_DATA_KEY = 'uptime-sources'
export const uptimeStatusDataKey = (slug: string | null) => `uptime-status:${slug ?? ''}`

export const UPTIME_POLL_MS = 10_000
/** Checks shown in each card's history strip, and the `recent` the page asks the daemon for. */
export const UPTIME_HISTORY_LENGTH = 30
export const UPTIME_MONITOR_QUERY = 'monitor'
/** Closed incidents listed on the page, and in a monitor's drawer. */
export const UPTIME_CLOSED_INCIDENTS = 20
export const UPTIME_DRAWER_CHECKS = 50

export const uptimeCardId = (monitorId: string) => `uptime-monitor-${monitorId}`

export type UptimeColor = 'success' | 'warning' | 'error' | 'neutral'

export interface UptimeStateDisplay {
  label: string
  color: UptimeColor
  icon: string
  iconClass: string
}

const STATE_DISPLAY: Record<MonitorState, UptimeStateDisplay> = {
  up: { label: 'Up', color: 'success', icon: 'i-lucide-circle-check', iconClass: 'text-success' },
  degraded: { label: 'Degraded', color: 'warning', icon: 'i-lucide-triangle-alert', iconClass: 'text-warning' },
  down: { label: 'Down', color: 'error', icon: 'i-lucide-circle-x', iconClass: 'text-error' },
  unknown: { label: 'No data', color: 'neutral', icon: 'i-lucide-circle-help', iconClass: 'text-muted' },
}

const DISABLED_DISPLAY: UptimeStateDisplay = { label: 'Disabled', color: 'neutral', icon: 'i-lucide-circle-pause', iconClass: 'text-muted' }

/** A disabled monitor's derived state is frozen at its last check, so it reads as disabled instead. */
export function uptimeStateDisplay(status: Pick<MonitorStatus, 'state' | 'monitor'>): UptimeStateDisplay {
  return status.monitor.enabled ? STATE_DISPLAY[status.state] : DISABLED_DISPLAY
}

export function uptimeSourceLabel(sources: readonly MonitorSourceInfo[], id: string): string {
  return sources.find(source => source.id === id)?.label ?? id
}

export function uptimeLatencyText(latencyMs: number): string {
  return latencyMs < 1000 ? `${latencyMs} ms` : `${(latencyMs / 1000).toFixed(latencyMs < 10_000 ? 2 : 1)} s`
}

export function uptimeIntervalText(seconds: number): string {
  if (seconds % 3600 === 0) return seconds === 3600 ? 'every hour' : `every ${seconds / 3600} h`
  if (seconds % 60 === 0) return seconds === 60 ? 'every minute' : `every ${seconds / 60} min`
  return `every ${seconds} s`
}

/** Compact span such as `3 min` or `2 h 5 min`; an open incident measures up to `now`. */
export function uptimeDurationText(startIso: string, endIso: string | null, now = Date.now()): string {
  const end = endIso ? Date.parse(endIso) : now
  const seconds = Math.max(0, Math.round((end - Date.parse(startIso)) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`
}

/** Changes exactly when an incident opens or closes, which is when the closed list needs re-reading. */
export function uptimeOpenIncidents(statuses: readonly MonitorStatus[]): MonitorIncident[] {
  return statuses
    .flatMap(status => (status.openIncident ? [status.openIncident] : []))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
}

export function uptimeTargetText(target: string): string {
  try {
    const url = new URL(target)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  }
  catch {
    return target
  }
}

export type UptimeHistoryBar =
  | { kind: 'empty', key: string }
  | { kind: 'check', key: string, check: MonitorCheckRecord, color: UptimeColor, label: string }

const CHECK_COLORS: Record<MonitorCheckRecord['status'], UptimeColor> = { up: 'success', degraded: 'warning', down: 'error' }
const CHECK_LABELS: Record<MonitorCheckRecord['status'], string> = { up: 'Up', degraded: 'Degraded', down: 'Down' }

/** Oldest to newest, padded at the start so the newest check always sits at the right edge. */
export function uptimeHistoryBars(recentChecks: readonly MonitorCheckRecord[], length = UPTIME_HISTORY_LENGTH): UptimeHistoryBar[] {
  const checks = recentChecks.slice(0, length).reverse()
  const empty: UptimeHistoryBar[] = Array.from({ length: length - checks.length }, (_, index) => ({ kind: 'empty', key: `empty-${index}` }))
  return [
    ...empty,
    ...checks.map((check): UptimeHistoryBar => {
      const parts = [CHECK_LABELS[check.status], uptimeLatencyText(check.latencyMs)]
      if (check.detail) parts.push(check.detail)
      return { kind: 'check', key: String(check.id), check, color: CHECK_COLORS[check.status], label: parts.join(' · ') }
    }),
  ]
}

export type UptimeOptionsDraft = Record<string, string>

export interface UptimeMonitorDraft {
  name: string
  sourceType: string
  target: string
  /** Null while the number input is empty. */
  intervalSeconds: number | null
  options: UptimeOptionsDraft
}

export function uptimeOptionsDraft(fields: readonly MonitorOptionField[], options?: MonitorOptions): UptimeOptionsDraft {
  const draft: UptimeOptionsDraft = {}
  for (const field of fields) {
    const value = options ? options[field.name] : field.default
    draft[field.name] = value === undefined ? '' : String(value)
  }
  return draft
}

export function uptimeMonitorDraft(monitor: Monitor | null, sources: readonly MonitorSourceInfo[]): UptimeMonitorDraft {
  const sourceType = monitor?.sourceType ?? sources[0]?.id ?? ''
  const fields = sources.find(source => source.id === sourceType)?.fields ?? []
  return {
    name: monitor?.name ?? '',
    sourceType,
    target: monitor?.target ?? '',
    intervalSeconds: monitor?.intervalSeconds ?? MONITOR_INTERVAL_DEFAULT_SECONDS,
    options: uptimeOptionsDraft(fields, monitor?.options),
  }
}

/** Blank fields are left out so the daemon applies the field's default. */
export function uptimeOptionsPayload(fields: readonly MonitorOptionField[], draft: UptimeOptionsDraft): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const field of fields) {
    const value = draft[field.name]?.trim()
    if (value) payload[field.name] = value
  }
  return payload
}

export interface UptimeFormError {
  /** `name`, `sourceType`, `target`, `intervalSeconds` or `options.<field>`. */
  name: string
  message: string
}

const optionErrorName = (error: MonitorOptionError) => (error.field ? `options.${error.field}` : 'sourceType')

export function uptimeFormErrors(sources: readonly MonitorSourceInfo[], draft: UptimeMonitorDraft): UptimeFormError[] {
  const errors: UptimeFormError[] = []
  const name = draft.name.trim()
  if (!name) errors.push({ name: 'name', message: 'Name is required' })
  else if (name.length > MONITOR_NAME_MAX_LENGTH) errors.push({ name: 'name', message: `At most ${MONITOR_NAME_MAX_LENGTH} characters` })

  const source = sources.find(candidate => candidate.id === draft.sourceType)
  if (!source) errors.push({ name: 'sourceType', message: 'Choose a monitor type' })

  const target = draft.target.trim()
  if (!target) errors.push({ name: 'target', message: `${source?.targetLabel ?? 'Target'} is required` })
  else if (target.length > MONITOR_TARGET_MAX_LENGTH) errors.push({ name: 'target', message: `At most ${MONITOR_TARGET_MAX_LENGTH} characters` })
  else if (!/^https?:\/\/\S+$/i.test(target)) errors.push({ name: 'target', message: 'Must be an http:// or https:// URL' })

  const interval = draft.intervalSeconds
  if (interval === null || !Number.isInteger(interval) || interval < MONITOR_INTERVAL_MIN_SECONDS || interval > MONITOR_INTERVAL_MAX_SECONDS) {
    errors.push({ name: 'intervalSeconds', message: `A whole number of seconds from ${MONITOR_INTERVAL_MIN_SECONDS} to ${MONITOR_INTERVAL_MAX_SECONDS}` })
  }

  if (source) {
    const result = validateMonitorOptions(source.fields, uptimeOptionsPayload(source.fields, draft.options))
    if (!result.ok) errors.push(...result.errors.map(error => ({ name: optionErrorName(error), message: error.message })))
  }
  return errors
}

export function uptimeCreateBody(fields: readonly MonitorOptionField[], draft: UptimeMonitorDraft): CreateMonitorRequest {
  return {
    name: draft.name.trim(),
    sourceType: draft.sourceType,
    target: draft.target.trim(),
    ...(draft.intervalSeconds === null ? {} : { intervalSeconds: draft.intervalSeconds }),
    options: uptimeOptionsPayload(fields, draft.options),
  }
}

function sameOptions(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every(key => String(a[key] ?? '') === String(b[key] ?? ''))
}

/** Only what changed, since a changed target, type or options cancels the in-flight check and rechecks. */
export function uptimeUpdateBody(monitor: Monitor, fields: readonly MonitorOptionField[], draft: UptimeMonitorDraft): UpdateMonitorRequest {
  const body: UpdateMonitorRequest = {}
  const name = draft.name.trim()
  const target = draft.target.trim()
  if (name !== monitor.name) body.name = name
  if (target !== monitor.target) body.target = target
  if (draft.intervalSeconds !== null && draft.intervalSeconds !== monitor.intervalSeconds) body.intervalSeconds = draft.intervalSeconds

  const options = uptimeOptionsPayload(fields, draft.options)
  if (draft.sourceType !== monitor.sourceType) {
    body.sourceType = draft.sourceType
    body.options = options
  }
  else {
    // Stored options have their defaults filled in, so the draft is compared after the same normalising.
    const normalised = validateMonitorOptions(fields, options)
    if (!normalised.ok || !sameOptions(normalised.options, monitor.options)) body.options = options
  }
  return body
}
