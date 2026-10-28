import type { Monitor, MonitorCheckRecord, MonitorSourceInfo } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  uptimeCreateBody,
  uptimeDurationText,
  uptimeFormErrors,
  uptimeHistoryBars,
  uptimeIntervalText,
  uptimeLatencyText,
  uptimeMonitorDraft,
  uptimeOpenIncidents,
  uptimeStateDisplay,
  uptimeTargetText,
  uptimeUpdateBody,
  type UptimeMonitorDraft,
} from '../../app/utils/uptime'

const http: MonitorSourceInfo = {
  id: 'http',
  label: 'HTTP',
  description: 'Fetches a URL.',
  targetLabel: 'URL',
  fields: [
    { kind: 'integer', name: 'expectedStatus', label: 'Expected status', min: 100, max: 599, default: 200 },
    { kind: 'string', name: 'responseContains', label: 'Response contains', maxLength: 500 },
  ],
}
const statuspage: MonitorSourceInfo = {
  id: 'statuspage',
  label: 'Statuspage',
  description: 'A Statuspage component.',
  targetLabel: 'Components feed URL',
  fields: [{ kind: 'string', name: 'componentId', label: 'Component ID', required: true, pattern: '[A-Za-z0-9_-]+', maxLength: 64 }],
}
const SOURCES = [http, statuspage]

const monitor = (overrides: Partial<Monitor> = {}): Monitor => ({
  id: 'm1',
  projectId: 'p1',
  name: 'Website',
  sourceType: 'http',
  target: 'https://example.com/health',
  intervalSeconds: 60,
  enabled: true,
  options: { expectedStatus: 200 },
  createdAt: '2026-10-28T00:00:00Z',
  updatedAt: '2026-10-28T00:00:00Z',
  ...overrides,
})

const check = (id: number, status: MonitorCheckRecord['status'], latencyMs = 120, detail: string | null = null): MonitorCheckRecord => ({
  id,
  monitorId: 'm1',
  checkedAt: `2026-10-28T00:0${id}:00Z`,
  ok: status === 'up',
  status,
  httpStatus: 200,
  latencyMs,
  detail,
})

const draft = (overrides: Partial<UptimeMonitorDraft> = {}): UptimeMonitorDraft => ({
  name: 'Website',
  sourceType: 'http',
  target: 'https://example.com/health',
  intervalSeconds: 60,
  options: { expectedStatus: '', responseContains: '' },
  ...overrides,
})

describe('uptimeStateDisplay', () => {
  it('colours each state and shows a disabled monitor as disabled whatever its last state', () => {
    expect(uptimeStateDisplay({ state: 'up', monitor: monitor() })).toMatchObject({ label: 'Up', color: 'success' })
    expect(uptimeStateDisplay({ state: 'degraded', monitor: monitor() })).toMatchObject({ label: 'Degraded', color: 'warning' })
    expect(uptimeStateDisplay({ state: 'down', monitor: monitor() })).toMatchObject({ label: 'Down', color: 'error' })
    expect(uptimeStateDisplay({ state: 'unknown', monitor: monitor() })).toMatchObject({ color: 'neutral' })
    expect(uptimeStateDisplay({ state: 'down', monitor: monitor({ enabled: false }) })).toMatchObject({ label: 'Disabled', color: 'neutral' })
  })
})

describe('uptimeHistoryBars', () => {
  it('orders checks oldest to newest and pads the start up to the strip length', () => {
    const bars = uptimeHistoryBars([check(3, 'down', 40, 'Connection refused.'), check(2, 'degraded', 2500), check(1, 'up')], 5)
    expect(bars.map(bar => bar.kind)).toEqual(['empty', 'empty', 'check', 'check', 'check'])
    const checks = bars.filter(bar => bar.kind === 'check')
    expect(checks.map(bar => [bar.check.id, bar.color])).toEqual([[1, 'success'], [2, 'warning'], [3, 'error']])
    expect(checks[2]!.label).toBe('Down · 40 ms · Connection refused.')
    expect(new Set(bars.map(bar => bar.key)).size).toBe(5)
  })

  it('keeps only the newest checks when there are more than fit', () => {
    const bars = uptimeHistoryBars([check(4, 'up'), check(3, 'up'), check(2, 'down'), check(1, 'down')], 2)
    expect(bars.map(bar => (bar.kind === 'check' ? bar.check.id : null))).toEqual([3, 4])
  })
})

describe('formatting', () => {
  it('formats latency, interval and target', () => {
    expect(uptimeLatencyText(87)).toBe('87 ms')
    expect(uptimeLatencyText(2345)).toBe('2.35 s')
    expect(uptimeLatencyText(12_340)).toBe('12.3 s')
    expect(uptimeIntervalText(60)).toBe('every minute')
    expect(uptimeIntervalText(300)).toBe('every 5 min')
    expect(uptimeIntervalText(45)).toBe('every 45 s')
    expect(uptimeIntervalText(7200)).toBe('every 2 h')
    expect(uptimeTargetText('https://status.example.com/api/v2/components.json')).toBe('status.example.com/api/v2/components.json')
    expect(uptimeTargetText('https://example.com/')).toBe('example.com')
  })
})

describe('the monitor form', () => {
  it('starts a new monitor on the first type with its defaults and an edit from the stored values', () => {
    expect(uptimeMonitorDraft(null, SOURCES)).toEqual({ name: '', sourceType: 'http', target: '', intervalSeconds: 60, options: { expectedStatus: '200', responseContains: '' } })
    const stored = monitor({ sourceType: 'statuspage', options: { componentId: 'abc' } })
    expect(uptimeMonitorDraft(stored, SOURCES)).toMatchObject({ sourceType: 'statuspage', options: { componentId: 'abc' } })
  })

  it('validates the common fields and the type\'s option fields', () => {
    expect(uptimeFormErrors(SOURCES, draft())).toEqual([])
    const errors = uptimeFormErrors(SOURCES, draft({ name: ' ', target: 'ftp://x', intervalSeconds: 10, options: { expectedStatus: '42' } }))
    expect(errors.map(error => error.name)).toEqual(['name', 'target', 'intervalSeconds', 'options.expectedStatus'])
    expect(uptimeFormErrors(SOURCES, draft({ intervalSeconds: null })).map(error => error.name)).toEqual(['intervalSeconds'])
    expect(uptimeFormErrors(SOURCES, draft({ sourceType: 'statuspage', options: { componentId: '' } }))).toEqual([{ name: 'options.componentId', message: 'Component ID is required.' }])
    expect(uptimeFormErrors(SOURCES, draft({ sourceType: 'nope' })).map(error => error.name)).toEqual(['sourceType'])
  })

  it('creates with trimmed values and blank options left to their defaults', () => {
    expect(uptimeCreateBody(http.fields, draft({ name: ' Website ', options: { expectedStatus: ' ', responseContains: 'ok' } }))).toEqual({
      name: 'Website',
      sourceType: 'http',
      target: 'https://example.com/health',
      intervalSeconds: 60,
      options: { responseContains: 'ok' },
    })
  })

  it('updates only what changed, treating a blank default as unchanged', () => {
    const stored = monitor()
    expect(uptimeUpdateBody(stored, http.fields, draft())).toEqual({})
    expect(uptimeUpdateBody(stored, http.fields, draft({ options: { expectedStatus: '200', responseContains: '' } }))).toEqual({})
    expect(uptimeUpdateBody(stored, http.fields, draft({ name: 'Site', intervalSeconds: 120 }))).toEqual({ name: 'Site', intervalSeconds: 120 })
    expect(uptimeUpdateBody(stored, http.fields, draft({ options: { expectedStatus: '204', responseContains: '' } }))).toEqual({ options: { expectedStatus: '204' } })
    expect(uptimeUpdateBody(stored, statuspage.fields, draft({ sourceType: 'statuspage', options: { componentId: 'abc' } })))
      .toEqual({ sourceType: 'statuspage', options: { componentId: 'abc' } })
  })

  it('formats incident durations, measuring open ones to now', () => {
    const start = '2026-01-01T00:00:00.000Z'
    expect(uptimeDurationText(start, '2026-01-01T00:00:42.000Z')).toBe('42 s')
    expect(uptimeDurationText(start, '2026-01-01T00:03:10.000Z')).toBe('3 min')
    expect(uptimeDurationText(start, '2026-01-01T02:05:00.000Z')).toBe('2 h 5 min')
    expect(uptimeDurationText(start, '2026-01-02T00:00:00.000Z')).toBe('1 d')
    expect(uptimeDurationText(start, null, Date.parse('2026-01-01T00:10:00.000Z'))).toBe('10 min')
  })

  it('lists open incidents newest first', () => {
    const incident = (id: string, openedAt: string) => ({ id, projectId: 'p', monitorId: id, openedAt, closedAt: null, reason: 'x', threadId: null })
    const status = (openIncident: ReturnType<typeof incident> | null) => ({ monitor: monitor(), state: 'down' as const, lastCheck: null, openIncident, recentChecks: [] })
    const result = uptimeOpenIncidents([status(incident('a', '2026-01-01T00:00:00Z')), status(null), status(incident('b', '2026-01-02T00:00:00Z'))])
    expect(result.map(entry => entry.id)).toEqual(['b', 'a'])
  })
})
