import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Monitor, Project } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformDatabase } from '../db'
import { uptimeChecks } from '../db/schema'
import { createProject, deleteProject } from '../projects/projects'
import { openTestDatabase } from '../testing'
import type { MonitorCheckContext, MonitorCheckResult } from './check'
import { listMonitorChecks } from './checks'
import { startUptimeScheduler, type UptimeScheduler, type UptimeSchedulerDeps, type UptimeSchedulerOptions } from './scheduler'
import { createMonitor, deleteMonitor, setMonitorEnabled, updateMonitor } from './service'
import { createMonitorSourceRegistry, defineMonitorSource } from './sources'

const T0 = Date.parse('2026-10-01T00:00:00.000Z')

let database: PlatformDatabase
let root: string
let project: Project
let started: UptimeScheduler[]
let calls: { target: string, at: number }[]
let latencyMs: number
let active: number
let maxActive: number

const fake = defineMonitorSource({
  id: 'fake',
  label: 'Fake',
  description: 'Answers after a configurable delay.',
  targetLabel: 'URL',
  fields: [],
  async check({ target, signal }: MonitorCheckContext): Promise<MonitorCheckResult> {
    const checkedAt = new Date().toISOString()
    calls.push({ target, at: Date.now() - T0 })
    active++
    maxActive = Math.max(maxActive, active)
    try {
      if (latencyMs > 0) await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, latencyMs)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
    }
    finally {
      active--
    }
    if (signal?.aborted) return { ok: false, status: 'down', httpStatus: null, detail: 'Check cancelled.', latencyMs, checkedAt }
    return { ok: true, status: 'up', httpStatus: 200, detail: null, latencyMs, checkedAt }
  },
})
const sources = createMonitorSourceRegistry([fake])

beforeEach(async () => {
  database = openTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-scheduler-'))
  mkdirSync(join(root, '.beads'))
  project = await createProject(database.db, { name: 'Alpha', source: { kind: 'local-path', path: root } })
  started = []
  calls = []
  latencyMs = 0
  active = 0
  maxActive = 0
  vi.useFakeTimers({ now: T0 })
})
afterEach(() => {
  for (const scheduler of started) scheduler.close()
  vi.useRealTimers()
  database.close()
  rmSync(root, { recursive: true, force: true })
})

const monitor = (name: string, intervalSeconds: number, target = `https://${name.toLowerCase()}.test/health`): Monitor =>
  createMonitor(database.db, project.id, { name, sourceType: 'fake', target, intervalSeconds, options: {} }, sources)

function start(deps: Partial<UptimeSchedulerDeps> = {}, options: UptimeSchedulerOptions = {}): UptimeScheduler {
  const scheduler = startUptimeScheduler({ db: database.db, sources, ...deps }, { staggerWindowMs: 0, ...options })
  started.push(scheduler)
  return scheduler
}

const seconds = (ms: number) => ms / 1000
const callTimes = (target: string) => calls.filter(c => c.target === target).map(c => seconds(c.at))
async function advance(s: number) {
  await vi.advanceTimersByTimeAsync(s * 1000)
  // A check finishing exactly at the end still has promise hops left before it is stored.
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const storedCount = () => database.db.select().from(uptimeChecks).all().length

describe('uptime scheduler', () => {
  it('fires two monitors at their own cadence and stores each check', async () => {
    const fast = monitor('Fast', 30)
    const slow = monitor('Slow', 45)
    const scheduler = start()
    const seen: string[] = []
    scheduler.onCheck(({ monitor, check }) => void seen.push(`${monitor.name}:${check.status}`))
    await advance(90)
    expect(callTimes(fast.target)).toEqual([0, 30, 60, 90])
    expect(callTimes(slow.target)).toEqual([0, 45, 90])
    expect(storedCount()).toBe(7)
    expect(seen.filter(s => s === 'Fast:up')).toHaveLength(4)
    const checks = listMonitorChecks(database.db, fast.id)
    expect(checks.map(c => c.checkedAt)).toEqual([90, 60, 30, 0].map(s => new Date(T0 + s * 1000).toISOString()))
    expect(checks[0]).toMatchObject({ monitorId: fast.id, ok: true, status: 'up', httpStatus: 200, latencyMs: 0, detail: null })
  })

  it('staggers monitors that are due together by a hash of their id', () => {
    const monitors = ['A', 'B', 'C', 'D'].map(name => monitor(name, 60))
    const scheduler = start({}, { staggerWindowMs: 15_000 })
    const offsets = monitors.map(m => Date.parse(scheduler.nextCheckAt(m.id)!) - T0)
    for (const offset of offsets) expect(offset).toBeGreaterThanOrEqual(0)
    for (const offset of offsets) expect(offset).toBeLessThan(15_000)
    expect(new Set(offsets).size).toBeGreaterThan(1)
    scheduler.close()
    expect(start({}, { staggerWindowMs: 15_000 }).nextCheckAt(monitors[0]!.id)).toBe(new Date(T0 + offsets[0]!).toISOString())
  })

  it('changes the cadence when the interval is edited, without a restart', async () => {
    const m = monitor('Edit', 60)
    start()
    await advance(60)
    expect(callTimes(m.target)).toEqual([0, 60])
    await advance(10)
    updateMonitor(database.db, project.id, m.id, { intervalSeconds: 30 }, sources)
    await advance(80)
    expect(callTimes(m.target)).toEqual([0, 60, 90, 120, 150])
  })

  it('checks a changed target soon and discards the cancelled in-flight check', async () => {
    latencyMs = 20_000
    const m = monitor('Moved', 60)
    start()
    await advance(5)
    updateMonitor(database.db, project.id, m.id, { target: 'https://moved.test/new' }, sources)
    await advance(25)
    expect(calls.map(c => [c.target, seconds(c.at)])).toEqual([[m.target, 0], ['https://moved.test/new', 5]])
    expect(listMonitorChecks(database.db, m.id).map(c => c.checkedAt)).toEqual([new Date(T0 + 5000).toISOString()])
  })

  it('never overlaps a slow check with the next one', async () => {
    latencyMs = 75_000
    const m = monitor('Slow', 30)
    start()
    await advance(200)
    expect(maxActive).toBe(1)
    expect(callTimes(m.target)).toEqual([0, 90, 180])
    expect(listMonitorChecks(database.db, m.id)).toHaveLength(2)
  })

  it('stops on disable and delete, resumes on enable, and drops monitors of a deleted project', async () => {
    const a = monitor('A', 30)
    const b = monitor('B', 30)
    const scheduler = start()
    await advance(0)
    expect(scheduler.scheduled().sort()).toEqual([a.id, b.id].sort())
    setMonitorEnabled(database.db, project.id, a.id, false)
    deleteMonitor(database.db, project.id, b.id)
    expect(scheduler.scheduled()).toEqual([])
    await advance(60)
    expect(callTimes(a.target)).toEqual([0])
    setMonitorEnabled(database.db, project.id, a.id, true)
    await advance(30)
    expect(callTimes(a.target)).toEqual([0, 60, 90])

    deleteProject(database.db, project.slug)
    await advance(30)
    expect(scheduler.scheduled()).toEqual([])
    expect(callTimes(a.target)).toEqual([0, 60, 90])
  })

  it('ignores monitor changes made to another database', () => {
    const other = openTestDatabase()
    try {
      const mine = start()
      const theirs = start({ db: other.db })
      monitor('Mine', 30)
      expect(mine.scheduled()).toHaveLength(1)
      expect(theirs.scheduled()).toEqual([])
    }
    finally {
      other.close()
    }
  })

  it('keeps exactly one schedule per monitor across a restart, counting from the last check', async () => {
    const dir = join(root, 'run')
    mkdirSync(dir)
    const ownerFile = join(dir, 'uptime-scheduler.owner')
    const a = monitor('A', 30)
    const b = monitor('B', 45)
    const first = start({ key: root, ownerFile })
    await advance(10)
    expect(vi.getTimerCount()).toBe(2)

    const second = start({ key: root, ownerFile })
    expect(first.scheduled()).toEqual([])
    expect(second.scheduled()).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(2)
    expect(second.nextCheckAt(a.id)).toBe(new Date(T0 + 30_000).toISOString())
    await advance(80)
    expect(callTimes(a.target)).toEqual([0, 30, 60, 90])
    expect(callTimes(b.target)).toEqual([0, 45, 90])

    second.close()
    expect(existsSync(ownerFile)).toBe(false)
  })

  it('stops a scheduler from another process once a newer one owns the data directory', async () => {
    const ownerFile = join(root, 'uptime-scheduler.owner')
    const a = monitor('A', 30)
    const log = { warn: vi.fn(), error: vi.fn() }
    const stale = start({ key: 'old process', ownerFile, log })
    const fresh = start({ key: 'new process', ownerFile })
    expect(readFileSync(ownerFile, 'utf8')).not.toBe('')
    await advance(65)
    expect(stale.scheduled()).toEqual([])
    expect(log.warn).toHaveBeenCalledOnce()
    expect(fresh.scheduled()).toEqual([a.id])
    expect(callTimes(a.target)).toEqual([0, 30, 60])
    stale.close()
    expect(existsSync(ownerFile)).toBe(true)
  })

  it('prunes history beyond the count and the age', async () => {
    const counted = monitor('Counted', 30)
    start({}, { historyMax: 3 })
    await advance(150)
    expect(listMonitorChecks(database.db, counted.id).map(c => seconds(Date.parse(c.checkedAt) - T0))).toEqual([150, 120, 90])

    for (const s of started) s.close()
    const aged = monitor('Aged', 30)
    start({}, { historyMax: 100, historyMaxAgeMs: 60_000 })
    await advance(150)
    const ages = listMonitorChecks(database.db, aged.id).map(c => seconds(Date.parse(c.checkedAt) - T0))
    expect(Math.min(...ages)).toBeGreaterThanOrEqual(seconds(Date.now() - T0) - 60)
    expect(ages).toHaveLength(3)
  })

  it('stops every timer and in-flight check on close', async () => {
    latencyMs = 10_000
    const m = monitor('A', 30)
    const scheduler = start()
    await advance(1)
    scheduler.close()
    expect(vi.getTimerCount()).toBe(0)
    await advance(60)
    expect(callTimes(m.target)).toEqual([0])
    expect(listMonitorChecks(database.db, m.id)).toEqual([])
  })
})
