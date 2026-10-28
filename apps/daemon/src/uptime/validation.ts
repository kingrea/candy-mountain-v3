import {
  MONITOR_INTERVAL_MAX_SECONDS, MONITOR_INTERVAL_MIN_SECONDS, MONITOR_NAME_MAX_LENGTH, MONITOR_TARGET_MAX_LENGTH,
  type CreateMonitorRequest, type UpdateMonitorRequest,
} from '@candy-mountain/shared'
import { MonitorError } from './errors'

const invalid = (message: string) => new MonitorError('invalid_request', message)

function asObject(body: unknown, what = 'Body'): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid(`${what} must be a JSON object`)
  return body as Record<string, unknown>
}

function parseName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('name must be a non-empty string')
  const name = value.trim()
  if (name.length > MONITOR_NAME_MAX_LENGTH) throw invalid(`name must be at most ${MONITOR_NAME_MAX_LENGTH} characters`)
  return name
}

function parseSourceType(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('sourceType must be a non-empty string')
  return value.trim()
}

function parseTarget(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('target must be a non-empty URL')
  const target = value.trim()
  if (target.length > MONITOR_TARGET_MAX_LENGTH) throw invalid(`target must be at most ${MONITOR_TARGET_MAX_LENGTH} characters`)
  let url: URL
  try {
    url = new URL(target)
  }
  catch {
    throw invalid('target must be an absolute http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('target must be an absolute http(s) URL')
  return target
}

function parseInterval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalid('intervalSeconds must be a whole number of seconds')
  if (value < MONITOR_INTERVAL_MIN_SECONDS) throw invalid(`intervalSeconds must be at least ${MONITOR_INTERVAL_MIN_SECONDS}`)
  if (value > MONITOR_INTERVAL_MAX_SECONDS) throw invalid(`intervalSeconds must be at most ${MONITOR_INTERVAL_MAX_SECONDS}`)
  return value
}

function parseEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw invalid('enabled must be true or false')
  return value
}

export function parseCreateMonitor(body: unknown): CreateMonitorRequest {
  const raw = asObject(body)
  const request: CreateMonitorRequest = { name: parseName(raw.name), sourceType: parseSourceType(raw.sourceType), target: parseTarget(raw.target) }
  if (raw.intervalSeconds !== undefined) request.intervalSeconds = parseInterval(raw.intervalSeconds)
  if (raw.enabled !== undefined) request.enabled = parseEnabled(raw.enabled)
  if (raw.options !== undefined && raw.options !== null) request.options = asObject(raw.options, 'options')
  return request
}

export function parseUpdateMonitor(body: unknown): UpdateMonitorRequest {
  const raw = asObject(body)
  const update: UpdateMonitorRequest = {}
  if (raw.name !== undefined) update.name = parseName(raw.name)
  if (raw.sourceType !== undefined) update.sourceType = parseSourceType(raw.sourceType)
  if (raw.target !== undefined) update.target = parseTarget(raw.target)
  if (raw.intervalSeconds !== undefined) update.intervalSeconds = parseInterval(raw.intervalSeconds)
  if (raw.enabled !== undefined) update.enabled = parseEnabled(raw.enabled)
  if (raw.options !== undefined && raw.options !== null) update.options = asObject(raw.options, 'options')
  return update
}
