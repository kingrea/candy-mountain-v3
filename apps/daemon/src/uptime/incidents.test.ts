import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Actor, ActivityListResponse, ApiErrorBody, IncidentListResponse, Monitor, MonitorCheckListResponse, MonitorStatusResponse, Project, UptimeStatusResponse,
} from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listActivityEvents } from '../activity'
import { createTestApp } from '../testing/platform'
import type { AuthStrategy } from '../auth'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { setEnabledModules } from '../project-modules/enablement'
import { archiveProject, createProject, unarchiveProject } from '../projects/projects'
import { openTestDatabase } from '../testing'
import { MONITOR_SOURCE_REGISTRY } from './builtin-sources'
import type { MonitorCheckResult } from './check'
import { listMonitorChecks, recordMonitorCheck } from './checks'
import { uptimeRoutes } from './definition'
import { findOpenIncident, listIncidents, setIncidentThread } from './incidents'
import { startUptimeScheduler, type UptimeScheduler, type UptimeSchedulerDeps } from './scheduler'
import { createMonitor } from './service'
import { createMonitorSourceRegistry, defineMonitorSource } from './sources'
import { deriveMonitorState, monitorStatus } from './state'
import { startIncidentTracker, type IncidentTracker } from './tracker'

const T0 = Date.parse('2026-10-01T00:00:00.000Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const retention = { historyMax: 500, historyMaxAgeMs: 30 * 86_400_000 }

type Outcome = 'up' | 'down' | 'slow' | 'degraded'

let database: PlatformDatabase
let root: string
let project: Project
let outcome: Outcome
let running: { scheduler: UptimeScheduler, tracker: IncidentTracker }[]

const fake = defineMonitorSource({
  id: 'fake',
  label: 'Fake',
  description: 'Answers with whatever the test says.',
  targetLabel: 'URL',
  fields: [],
  async check(): Promise<MonitorCheckResult> {
    const checkedAt = new Date().toISOString()
    if (outcome === 'down') return { ok: false, status: 'down', httpStatus: 503, detail: 'Expected status 200, got 503.', latencyMs: 12, checkedAt }
    if (outcome === 'degraded') return { ok: false, status: 'degraded', httpStatus: 200, detail: 'partial outage', latencyMs: 12, checkedAt }
    return { ok: true, status: 'up', httpStatus: 200, detail: null, latencyMs: outcome === 'slow' ? 2500 : 12, checkedAt }
  },
})
const sources = createMonitorSourceRegistry([fake])

beforeEach(async () => {
  database = openTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-incidents-'))
  mkdirSync(join(root, '.beads'))
  project = await createProject(database.db, { name: 'Alpha', source: { kind: 'local-path', path: root } })
  setEnabledModules(database.db, project.id, ['operations'])
  outcome = 'up'
  running = []
})
afterEach(() => {
  stop()
  vi.useRealTimers()
  database.close()
  rmSync(root, { recursive: true, force: true })
})

const monitor = (name = 'API', intervalSeconds = 30): Monitor =>
  createMonitor(database.db, project.id, { name, sourceType: 'fake', target: `https://${name.toLowerCase()}.test/health`, intervalSeconds, options: {} }, sources)

function start(deps: Partial<UptimeSchedulerDeps> = {}) {
  const scheduler = startUptimeScheduler({ db: database.db, sources, key: root, ...deps }, { staggerWindowMs: 0 })
  const tracker = startIncidentTracker({ db: database.db, scheduler, scopeUrlPrefix: 'p' })
  running.push({ scheduler, tracker })
  return scheduler
}

function stop() {
  for (const { scheduler, tracker } of running) {
    tracker.close()
    scheduler.close()
  }
  running = []
}

async function advance(s: number) {
  await vi.advanceTimersByTimeAsync(s * 1000)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const stateOf = (m: Monitor) => monitorStatus(database.db, m, 0).state
const incidents = () => listIncidents(database.db, project.id)
const events = () => listActivityEvents(database.db, project.id, {}).events.filter(e => e.type.startsWith('incident.')).reverse()

function app(roles = ['admin']) {
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createTestApp({ db: database.db, paths: dataPaths('/unused'), auth, runtime: uptimeRoutes() })
}
const get = async <T>(path: string) => {
  const res = await app().request(path)
  return { status: res.status, body: await res.json() as T }
}

describe('deriveMonitorState', () => {
  const check = (status: 'up' | 'degraded' | 'down', latencyMs = 10) => ({ status, latencyMs })

  it('needs the newest three checks to fail before it is down', () => {
    expect(deriveMonitorState([])).toBe('unknown')
    expect(deriveMonitorState([check('up'), check('up'), check('up')])).toBe('up')
    expect(deriveMonitorState([check('up')])).toBe('up')
    expect(deriveMonitorState([check('down'), check('up'), check('up')])).toBe('degraded')
    expect(deriveMonitorState([check('down'), check('down')])).toBe('degraded')
    expect(deriveMonitorState([check('down'), check('down'), check('up')])).toBe('degraded')
    expect(deriveMonitorState([check('down'), check('down'), check('down'), check('up')])).toBe('down')
  })

  it('treats a vendor degraded check or a slow response as degraded, never down', () => {
    expect(deriveMonitorState([check('up', 2001), check('up'), check('up')])).toBe('degraded')
    expect(deriveMonitorState([check('up', 2000), check('up'), check('up')])).toBe('up')
    expect(deriveMonitorState([check('degraded'), check('degraded'), check('degraded')])).toBe('degraded')
    expect(deriveMonitorState([check('degraded'), check('down'), check('down')])).toBe('degraded')
  })

  it('stays degraded after an outage until three good checks in a row', () => {
    expect(deriveMonitorState([check('up'), check('down'), check('down')])).toBe('degraded')
    expect(deriveMonitorState([check('up'), check('up'), check('down')])).toBe('degraded')
    expect(deriveMonitorState([check('up'), check('up'), check('up'), check('down')])).toBe('up')
  })
})

describe('incidents', () => {
  beforeEach(() => void vi.useFakeTimers({ now: T0 }))

  it('opens one incident after three consecutive failures and closes it on recovery', async () => {
    const m = monitor()
    start()
    await advance(0)
    expect(stateOf(m)).toBe('up')

    outcome = 'down'
    await advance(30)
    expect(stateOf(m)).toBe('degraded')
    await advance(30)
    expect(stateOf(m)).toBe('degraded')
    expect(incidents()).toEqual([])
    await advance(30)
    expect(stateOf(m)).toBe('down')
    expect(incidents()).toEqual([{ id: expect.any(String), projectId: project.id, monitorId: m.id, openedAt: at(90), closedAt: null, reason: 'Expected status 200, got 503.', threadId: null }])
    await advance(60)
    expect(incidents()).toHaveLength(1)

    outcome = 'up'
    await advance(30)
    expect(stateOf(m)).toBe('degraded')
    expect(findOpenIncident(database.db, m.id)).not.toBeNull()
    await advance(60)
    expect(stateOf(m)).toBe('up')
    const [incident] = incidents()
    expect(incident).toMatchObject({ openedAt: at(90), closedAt: at(240) })

    const link = `/p/${project.slug}/uptime?monitor=${m.id}`
    expect(events().map(e => [e.type, e.title, e.link])).toEqual([
      ['incident.opened', 'API is down: Expected status 200, got 503.', link],
      ['incident.closed', 'API is back up', link],
    ])
    expect(events()[1]!.payload).toEqual({ incidentId: incident!.id, monitorId: m.id, monitorName: 'API', openedAt: at(90), closedAt: at(240), durationMs: 150_000 })
  })

  it('shows a single failure as degraded without an incident', async () => {
    const m = monitor()
    start()
    await advance(0)
    outcome = 'down'
    await advance(30)
    outcome = 'up'
    expect(stateOf(m)).toBe('degraded')
    await advance(90)
    expect(stateOf(m)).toBe('up')
    expect(incidents()).toEqual([])
    expect(events()).toEqual([])
  })

  it('never opens an incident for slow or vendor-degraded checks', async () => {
    const m = monitor()
    outcome = 'slow'
    start()
    await advance(90)
    expect(stateOf(m)).toBe('degraded')
    outcome = 'degraded'
    await advance(90)
    expect(stateOf(m)).toBe('degraded')
    expect(incidents()).toEqual([])
  })

  it('keeps the open incident across a restart and opens no second one', async () => {
    const m = monitor()
    outcome = 'down'
    start()
    await advance(60)
    const [opened] = incidents()
    expect(opened?.closedAt).toBeNull()

    stop()
    await advance(5)
    start()
    expect(stateOf(m)).toBe('down')
    await advance(90)
    expect(incidents()).toEqual([opened])
    expect(events().map(e => e.type)).toEqual(['incident.opened'])

    outcome = 'up'
    await advance(90)
    expect(incidents()).toEqual([{ ...opened, closedAt: expect.any(String) }])
    expect(events().map(e => e.type)).toEqual(['incident.opened', 'incident.closed'])
  })

  it('settles a transition a crash left half done when it starts', () => {
    const m = monitor()
    for (const s of [0, 30, 60]) {
      recordMonitorCheck(database.db, m.id, { ok: false, status: 'down', httpStatus: null, detail: 'Connection refused.', latencyMs: 1, checkedAt: at(s) }, retention)
    }
    start()
    expect(incidents()).toMatchObject([{ openedAt: at(60), closedAt: null, reason: 'Connection refused.' }])
    stop()
    start()
    expect(incidents()).toHaveLength(1)
    expect(events().map(e => e.type)).toEqual(['incident.opened'])
  })

  it('pauses the monitors of an archived project and resumes them when unarchived', async () => {
    const m = monitor()
    const scheduler = start()
    await advance(30)
    expect(listMonitorChecks(database.db, m.id)).toHaveLength(2)

    archiveProject(database.db, project.slug)
    expect(scheduler.scheduled()).toEqual([])
    await advance(120)
    expect(listMonitorChecks(database.db, m.id)).toHaveLength(2)

    unarchiveProject(database.db, project.slug)
    expect(scheduler.scheduled()).toEqual([m.id])
    await advance(0)
    expect(listMonitorChecks(database.db, m.id)).toHaveLength(3)
  })

  it('stores a thread reference on an incident without touching its state', async () => {
    monitor()
    outcome = 'down'
    start()
    await advance(60)
    const [incident] = incidents()
    expect(setIncidentThread(database.db, incident!.id, null)).toEqual(incident)
    expect(setIncidentThread(database.db, 'missing', null)).toBeNull()
  })
})

describe('uptime state routes', () => {
  beforeEach(() => void vi.useFakeTimers({ now: T0 }))

  it('serves state, recent checks and incidents per monitor and project-wide', async () => {
    const m = monitor('API')
    const quiet = monitor('Quiet')
    outcome = 'down'
    start()
    await advance(60)
    stop()
    const base = `/projects/${project.slug}`

    const status = await get<MonitorStatusResponse>(`${base}/monitors/${m.id}/status?recent=2`)
    expect(status.status).toBe(200)
    expect(status.body.status).toMatchObject({ monitor: { id: m.id }, state: 'down', lastCheck: { checkedAt: at(60), status: 'down' }, openIncident: { monitorId: m.id } })
    expect(status.body.status.recentChecks.map(c => c.checkedAt)).toEqual([at(60), at(30)])

    const checks = await get<MonitorCheckListResponse>(`${base}/monitors/${m.id}/checks?limit=10`)
    expect(checks.body.checks.map(c => c.checkedAt)).toEqual([at(60), at(30), at(0)])

    const perMonitor = await get<IncidentListResponse>(`${base}/monitors/${m.id}/incidents?status=open`)
    expect(perMonitor.body.incidents).toHaveLength(1)
    expect((await get<IncidentListResponse>(`${base}/monitors/${m.id}/incidents?status=closed`)).body.incidents).toEqual([])

    const board = await get<UptimeStatusResponse>(`${base}/uptime/status?recent=0`)
    expect(board.body.monitors.map(s => [s.monitor.name, s.state, s.recentChecks.length, s.openIncident !== null])).toEqual([
      ['API', 'down', 0, true],
      ['Quiet', 'down', 0, true],
    ])

    const all = await get<IncidentListResponse>(`${base}/uptime/incidents`)
    expect(all.body.incidents).toHaveLength(2)
    const filtered = await get<IncidentListResponse>(`${base}/uptime/incidents?monitor=${quiet.id}&limit=1`)
    expect(filtered.body.incidents.map(i => i.monitorId)).toEqual([quiet.id])

    const activity = await get<ActivityListResponse>(`${base}/activity?type=incident.opened`)
    expect(activity.body.events.map(e => e.link).sort()).toEqual([m.id, quiet.id].map(id => `/p/${project.slug}/uptime?monitor=${id}`).sort())
  })

  it('reports an unknown state with no history and rejects bad queries', async () => {
    const m = monitor()
    const base = `/projects/${project.slug}`
    expect((await get<MonitorStatusResponse>(`${base}/monitors/${m.id}/status`)).body.status).toMatchObject({ state: 'unknown', lastCheck: null, openIncident: null, recentChecks: [] })
    const bad = async (path: string, code: string, status: number) => {
      const res = await get<ApiErrorBody>(path)
      expect([res.status, res.body.error.code]).toEqual([status, code])
    }
    await bad(`${base}/monitors/${m.id}/status?recent=-1`, 'invalid_request', 400)
    await bad(`${base}/monitors/${m.id}/checks?limit=0`, 'invalid_request', 400)
    await bad(`${base}/monitors/${m.id}/incidents?status=maybe`, 'invalid_request', 400)
    await bad(`${base}/uptime/status?recent=201`, 'invalid_request', 400)
    await bad(`${base}/uptime/incidents?monitor=nope`, 'not_found', 404)
    await bad(`${base}/monitors/nope/status`, 'not_found', 404)
    await bad('/projects/nope/uptime/status', 'not_found', 404)
  })
})

describe('incidents against a stub service', () => {
  let server: Server
  let healthy: boolean

  beforeEach(async () => {
    healthy = true
    server = createServer((_req, res) => {
      res.writeHead(healthy ? 200 : 503).end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })
  afterEach(async () => {
    await new Promise(resolve => server.close(resolve))
  })

  it('goes degraded then down when the service fails, and closes the incident when it recovers', async () => {
    const { port } = server.address() as AddressInfo
    const m = createMonitor(database.db, project.id, { name: 'Stub', sourceType: 'http', target: `http://127.0.0.1:${port}/health`, intervalSeconds: 30, options: {} })
    start({ sources: MONITOR_SOURCE_REGISTRY })
    const tick = async (expectedChecks: number) => {
      await vi.advanceTimersByTimeAsync(expectedChecks === 1 ? 0 : 30_000)
      await vi.waitFor(() => expect(listMonitorChecks(database.db, m.id)).toHaveLength(expectedChecks))
    }

    await tick(1)
    expect(stateOf(m)).toBe('up')
    healthy = false
    const states: string[] = []
    for (let n = 2; n <= 4; n++) {
      await tick(n)
      states.push(stateOf(m))
    }
    expect(states).toEqual(['degraded', 'degraded', 'down'])
    expect(incidents()).toMatchObject([{ closedAt: null, reason: 'Expected status 200, got 503.' }])

    healthy = true
    for (let n = 5; n <= 7; n++) await tick(n)
    expect(stateOf(m)).toBe('up')
    expect(incidents()).toMatchObject([{ closedAt: at(180) }])
    expect(events().map(e => e.type)).toEqual(['incident.opened', 'incident.closed'])
  })
})
