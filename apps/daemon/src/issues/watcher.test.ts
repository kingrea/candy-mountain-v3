import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformDatabase } from '../db'
import { archiveProject, createProject, deleteProject, unarchiveProject } from '../projects'
import { openTestDatabase } from '../testing'
import { runBd } from './bd-runner'
import { createTempBeadsWorkspace, hasBd, type TempBeadsWorkspace } from './test-workspace'
import { ISSUE_WATCH_MIN_INTERVAL_MS, startIssueWatcher, type IssueWatcher } from './watcher'

const execFileAsync = promisify(execFile)

// Async on purpose: a sync spawn would block the event loop and fold every write into one batch.
async function bd(cwd: string, ...args: string[]): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, BD_NON_INTERACTIVE: '1' }
  delete env.BEADS_DIR
  delete env.BEADS_DB
  await execFileAsync('bd', args, { cwd, env })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<number> {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Condition not met within ${timeoutMs}ms`)
    await sleep(20)
  }
  return Date.now() - started
}

describe.skipIf(!hasBd)('issue watcher against a real workspace', () => {
  let workspace: TempBeadsWorkspace
  let database: PlatformDatabase
  let watcher: IssueWatcher | undefined
  let projectId: string
  const invalidate = vi.fn<(projectId: string) => void>()

  beforeEach(async () => {
    workspace = createTempBeadsWorkspace('wt')
    database = openTestDatabase()
    const project = await createProject(database.db, { name: 'Watched', slug: 'watched', source: { kind: 'local-path', path: workspace.path } })
    projectId = project.id
    invalidate.mockReset()
  }, 30_000)

  afterEach(() => {
    watcher?.close()
    watcher = undefined
    database.close()
    workspace.cleanup()
  })

  // Only the burst test keeps the production spacing between notifications; the rest would just wait it out.
  async function start(minIntervalMs = 0): Promise<{ events: number[] }> {
    watcher = startIssueWatcher({ db: database.db, invalidate, minIntervalMs })
    const events: number[] = []
    watcher.subscribe(projectId, () => events.push(Date.now()))
    // Lets the baseline fingerprint settle so the first write is compared against it.
    await sleep(200)
    return { events }
  }

  it('emits a change and invalidates the list within two seconds of bd create', async () => {
    const { events } = await start()
    expect(watcher!.isWatching(projectId)).toBe(true)

    const started = Date.now()
    await bd(workspace.path, 'create', '--title', 'Seen by the watcher')
    await waitFor(() => events.length > 0, 2000)
    expect(events[0]! - started).toBeLessThan(2000)
    expect(invalidate).toHaveBeenCalledWith(projectId)
  }, 15_000)

  it('ignores reads, which rewrite Dolt files without changing data', async () => {
    workspace.create('Existing')
    const { events } = await start()
    for (let i = 0; i < 3; i++) {
      await runBd(workspace.path, ['list', '--all', '--limit', '0'])
      await runBd(workspace.path, ['ready', '--limit', '0'])
    }
    await sleep(1500)
    expect(events).toHaveLength(0)
  }, 20_000)

  it('folds a burst of ten writes into events spaced by the minimum interval', async () => {
    const { events } = await start(ISSUE_WATCH_MIN_INTERVAL_MS)
    const started = Date.now()
    for (let i = 0; i < 10; i++) await bd(workspace.path, 'create', '--title', `Burst ${i}`)
    await sleep(ISSUE_WATCH_MIN_INTERVAL_MS + 500)
    const elapsed = Date.now() - started
    expect(events.length).toBeGreaterThanOrEqual(1)
    // A fixed count flakes when slow bd processes stretch the burst; spacing and elapsed time do not.
    expect(events.length).toBeLessThanOrEqual(Math.floor(elapsed / ISSUE_WATCH_MIN_INTERVAL_MS) + 1)
    for (let i = 1; i < events.length; i++) {
      expect(events[i]! - events[i - 1]!).toBeGreaterThanOrEqual(ISSUE_WATCH_MIN_INTERVAL_MS - 50)
    }
  }, 60_000)

  it('serves every subscriber from one watch and stops notifying after unsubscribe', async () => {
    const { events } = await start()
    const second: number[] = []
    const unsubscribe = watcher!.subscribe(projectId, () => second.push(Date.now()))

    await bd(workspace.path, 'create', '--title', 'First')
    await waitFor(() => events.length === 1 && second.length === 1, 2000)

    unsubscribe()
    await bd(workspace.path, 'create', '--title', 'Second')
    await waitFor(() => events.length === 2, 2000)
    expect(second).toHaveLength(1)
  }, 15_000)

  it('stops watching deleted and archived projects and resumes on unarchive', async () => {
    const { events } = await start()

    archiveProject(database.db, 'watched')
    watcher!.reconcile()
    expect(watcher!.isWatching(projectId)).toBe(false)
    await bd(workspace.path, 'create', '--title', 'While archived')
    await sleep(800)
    expect(events).toHaveLength(0)

    unarchiveProject(database.db, 'watched')
    watcher!.reconcile()
    expect(watcher!.isWatching(projectId)).toBe(true)
    await sleep(200)
    await bd(workspace.path, 'create', '--title', 'After unarchive')
    await waitFor(() => events.length === 1, 2000)

    deleteProject(database.db, 'watched')
    watcher!.reconcile()
    expect(watcher!.isWatching(projectId)).toBe(false)
    await bd(workspace.path, 'create', '--title', 'After delete')
    await sleep(800)
    expect(events).toHaveLength(1)
  }, 30_000)

  it('picks up projects created after it started on the next reconcile', async () => {
    await start()
    const other = createTempBeadsWorkspace('wo')
    try {
      const project = await createProject(database.db, { name: 'Later', slug: 'later', source: { kind: 'local-path', path: other.path } })
      expect(watcher!.isWatching(project.id)).toBe(false)
      watcher!.reconcile()
      expect(watcher!.isWatching(project.id)).toBe(true)
    }
    finally {
      other.cleanup()
    }
  }, 30_000)

  it('notices the .beads directory disappearing and coming back', async () => {
    const { events } = await start()

    rmSync(join(workspace.path, '.beads'), { recursive: true, force: true })
    await waitFor(() => events.length === 1, 2000)
    expect(watcher!.isWatching(projectId)).toBe(false)

    await bd(workspace.path, 'init', '--non-interactive', '--prefix', 'wt', '--skip-agents', '--quiet')
    watcher!.reconcile()
    expect(watcher!.isWatching(projectId)).toBe(true)
    await waitFor(() => events.length >= 2, 2000)

    await sleep(500)
    const settled = events.length
    await bd(workspace.path, 'create', '--title', 'In the new directory')
    await waitFor(() => events.length > settled, 2000)
  }, 30_000)
})

describe('issue watcher without a tracker', () => {
  let database: PlatformDatabase
  let bare: string
  let watcher: IssueWatcher

  beforeEach(() => {
    database = openTestDatabase()
    bare = mkdtempSync(join(tmpdir(), 'candy-mountain-no-beads-'))
  })

  afterEach(() => {
    watcher?.close()
    database.close()
    rmSync(bare, { recursive: true, force: true })
  })

  it('tolerates projects without .beads or with a missing checkout, and aborts its signal on close', async () => {
    const plain = await createProject(database.db, { name: 'Plain', slug: 'plain', source: { kind: 'local-path', path: bare } })
    watcher = startIssueWatcher({ db: database.db, invalidate: () => {} })
    expect(watcher.isWatching(plain.id)).toBe(false)

    rmSync(bare, { recursive: true, force: true })
    expect(() => watcher.reconcile()).not.toThrow()

    watcher.close()
    expect(watcher.signal.aborted).toBe(true)
    expect(() => watcher.close()).not.toThrow()
  })
})
