import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema, type PlatformDatabase } from '../db'
import { startPlatform } from '../platform'
import { createProject } from '../projects/projects'
import { createTempDataDir, openTestDatabase, type TempDataDir } from '../testing'
import { resolveWorktreeSettings } from './config'
import { createGitRunner } from './git'
import { inspectWorktree } from './inspect'
import { createWorktreePool, type WorktreeHolder, type WorktreePool } from './pool'
import { startWorktreeReclaimer, type WorktreeReclaimer } from './reclaim'
import { createTempGitRepo, TEST_GIT_ENV, type TempGitRepo } from './test-repo'

const HOUR = 3_600_000
const holder = (id: string): WorktreeHolder => ({ kind: 'session', id })
const gitRunner = createGitRunner({ env: TEST_GIT_ENV })

let database: PlatformDatabase
let data: TempDataDir
let repo: TempGitRepo
let project: Project
let pool: WorktreePool
let reclaimer: WorktreeReclaimer | undefined
let clock: Date
const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }

async function setUp({ remote = true }: { remote?: boolean } = {}) {
  repo = createTempGitRepo({ remote })
  project = await createProject(database.db, { name: 'alpha', source: { kind: 'local-path', path: repo.clone } })
  pool = createWorktreePool({ db: database.db, paths: { worktrees: join(data.root, 'worktrees') }, git: gitRunner, now: () => clock }, { maxPerProject: 8 })
  reclaimer = startWorktreeReclaimer({ db: database.db, paths: { worktrees: join(data.root, 'worktrees') }, pool, now: () => clock, log }, { idleTimeoutMs: 2 * HOUR, reconcileOnStart: false })
}

async function acquire(id: string) {
  clock = new Date(clock.getTime() + 1000)
  return pool.acquire({ projectId: project.id, holder: holder(id), baseBranch: 'main' })
}

function commit(cwd: string, file: string) {
  writeFileSync(join(cwd, file), `${file}\n`)
  repo.git(cwd, 'add', file)
  repo.git(cwd, 'commit', '--quiet', '-m', file)
}

function worktreeList() {
  return repo.git(repo.clone, 'worktree', 'list', '--porcelain')
}

beforeEach(() => {
  database = openTestDatabase()
  data = createTempDataDir()
  clock = new Date('2026-01-01T00:00:00.000Z')
  vi.clearAllMocks()
})
afterEach(() => {
  reclaimer?.close()
  reclaimer = undefined
  database.close()
  repo?.cleanup()
  data.cleanup()
})

describe('inspectWorktree', () => {
  it('reports uncommitted files and commits the remote does not have', async () => {
    await setUp()
    const lease = await acquire('s1')
    expect(await inspectWorktree(gitRunner, lease.path)).toMatchObject({ exists: true, uncommitted: [], unpushedCommits: 0, remote: 'origin', fetched: true, unsafeReason: null })

    writeFileSync(join(lease.path, 'notes.txt'), 'draft\n')
    expect(await inspectWorktree(gitRunner, lease.path)).toMatchObject({ uncommitted: ['?? notes.txt'], unsafeReason: '1 uncommitted change(s)' })

    repo.git(lease.path, 'add', 'notes.txt')
    repo.git(lease.path, 'commit', '--quiet', '-m', 'notes')
    expect(await inspectWorktree(gitRunner, lease.path)).toMatchObject({ uncommitted: [], unpushedCommits: 1, unsafeReason: '1 commit(s) not on origin' })

    repo.git(lease.path, 'push', '--quiet', '-u', 'origin', lease.branch)
    expect((await inspectWorktree(gitRunner, lease.path)).unsafeReason).toBeNull()
  }, 30_000)

  it('counts commits that reached the remote another way as pushed', async () => {
    await setUp()
    const lease = await acquire('s1')
    const sha = repo.pushToOrigin('upstream.txt', 'x\n')
    repo.git(lease.path, 'fetch', '--quiet', 'origin')
    repo.git(lease.path, 'merge', '--quiet', '--ff-only', sha)
    expect(await inspectWorktree(gitRunner, lease.path)).toMatchObject({ unpushedCommits: 0, unsafeReason: null })
  }, 30_000)

  it('compares against other local branches when the clone has no remote', async () => {
    await setUp({ remote: false })
    const lease = await acquire('s1')
    expect(await inspectWorktree(gitRunner, lease.path)).toMatchObject({ remote: null, fetched: false, unsafeReason: null })
    commit(lease.path, 'work.txt')
    expect((await inspectWorktree(gitRunner, lease.path)).unsafeReason).toBe('1 commit(s) not on any other local branch')
  }, 30_000)

  it('treats a missing directory as safe and an unreadable one as unsafe', async () => {
    await setUp()
    expect(await inspectWorktree(gitRunner, join(data.root, 'nowhere'))).toMatchObject({ exists: false, unsafeReason: null })
    const stray = join(data.root, 'stray')
    mkdirSync(stray, { recursive: true })
    writeFileSync(join(stray, 'file.txt'), 'x')
    expect((await inspectWorktree(gitRunner, stray)).unsafeReason).toMatch(/^Cannot inspect the worktree/)
  }, 30_000)
})

describe('release', () => {
  it('keeps and flags a worktree with uncommitted work unless forced', async () => {
    await setUp()
    const lease = await acquire('s1')
    writeFileSync(join(lease.path, 'draft.txt'), 'x')
    const kept = await pool.release(lease.id)
    expect(kept).toMatchObject({ state: 'active', releasedAt: null, unpushedWork: true, unpushedReason: '1 uncommitted change(s)', inspectedAt: clock.toISOString() })
    expect(pool.get(lease.id)).toEqual(kept)
    expect(existsSync(join(lease.path, 'draft.txt'))).toBe(true)

    const forced = await pool.release(lease.id, { force: true })
    expect(forced).toMatchObject({ state: 'released', unpushedWork: false, unpushedReason: null })
    expect(existsSync(lease.path)).toBe(false)
  }, 30_000)

  it('releases once the work is pushed and clears the flag', async () => {
    await setUp()
    const lease = await acquire('s1')
    commit(lease.path, 'work.txt')
    expect(await pool.release(lease.id)).toMatchObject({ state: 'active', unpushedWork: true, unpushedReason: '1 commit(s) not on origin' })
    repo.git(lease.path, 'push', '--quiet', 'origin', lease.branch)
    expect(await pool.release(lease.id)).toMatchObject({ state: 'released', unpushedWork: false, unpushedReason: null })
  }, 30_000)
})

describe('reclaimIdle', () => {
  it('reclaims idle clean worktrees and keeps idle ones holding work', async () => {
    await setUp()
    const clean = await acquire('clean')
    const dirty = await acquire('dirty')
    const unpushed = await acquire('unpushed')
    writeFileSync(join(dirty.path, 'scratch.txt'), 'x')
    commit(unpushed.path, 'work.txt')
    clock = new Date(clock.getTime() + HOUR)
    const fresh = await acquire('fresh')
    clock = new Date(clock.getTime() + 1.5 * HOUR)

    const result = await reclaimer!.reclaimIdle()

    expect(result.reclaimed.map(lease => lease.id)).toEqual([clean.id])
    expect(result.kept.map(lease => [lease.id, lease.unpushedReason])).toEqual([[dirty.id, '1 uncommitted change(s)'], [unpushed.id, '1 commit(s) not on origin']])
    expect(result.failed).toEqual([])
    expect(existsSync(clean.path)).toBe(false)
    expect(existsSync(join(dirty.path, 'scratch.txt'))).toBe(true)
    expect(repo.git(unpushed.path, 'log', '-1', '--format=%s')).toBe('work.txt')
    expect(pool.list(project.id).map(lease => [lease.id, lease.unpushedWork])).toEqual([[dirty.id, true], [unpushed.id, true], [fresh.id, false]])
    expect(log.warn).toHaveBeenCalledTimes(2)

    repo.git(unpushed.path, 'push', '--quiet', 'origin', unpushed.branch)
    const second = await reclaimer!.reclaimIdle()
    expect(second.reclaimed.map(lease => lease.id)).toEqual([unpushed.id])
    expect(second.kept.map(lease => lease.id)).toEqual([dirty.id])
    expect(log.warn).toHaveBeenCalledTimes(2)
  }, 60_000)

  it('leaves a lease alone when it was resumed after the cutoff', async () => {
    await setUp()
    const lease = await acquire('s1')
    const cutoff = new Date(clock.getTime() - 1).toISOString()
    expect(await pool.release(lease.id, { unusedSince: cutoff })).toMatchObject({ state: 'active', unpushedWork: false })
    expect(existsSync(lease.path)).toBe(true)
  }, 30_000)
})

describe('reconcile', () => {
  it('closes leases whose directory was deleted by hand', async () => {
    await setUp()
    const gone = await acquire('gone')
    const kept = await acquire('kept')
    rmSync(gone.path, { recursive: true, force: true })

    const report = await reclaimer!.reconcile()

    expect(report.closedLeases.map(lease => lease.id)).toEqual([gone.id])
    expect(pool.get(gone.id)).toMatchObject({ state: 'released' })
    expect(pool.get(kept.id)).toMatchObject({ state: 'active' })
    expect(existsSync(kept.path)).toBe(true)
    expect(worktreeList()).not.toContain(gone.path)
  }, 30_000)

  it('removes clean unleased directories, reports dirty ones and prunes the clone', async () => {
    await setUp()
    const projectDir = join(data.root, 'worktrees', project.id)
    const leased = await acquire('leased')
    const cleanOrphan = join(projectDir, 'clean-orphan')
    const dirtyOrphan = join(projectDir, 'dirty-orphan')
    const emptyOrphan = join(projectDir, 'empty-orphan')
    repo.git(repo.clone, 'worktree', 'add', '--quiet', '-b', 'orphan-clean', cleanOrphan, 'origin/main')
    repo.git(repo.clone, 'worktree', 'add', '--quiet', '-b', 'orphan-dirty', dirtyOrphan, 'origin/main')
    writeFileSync(join(dirtyOrphan, 'unsaved.txt'), 'x')
    mkdirSync(emptyOrphan)
    const deletedProjectDir = join(data.root, 'worktrees', 'deleted-project')
    const deletedProjectOrphan = join(deletedProjectDir, 'lease')
    repo.git(repo.clone, 'worktree', 'add', '--quiet', '-b', 'orphan-deleted', deletedProjectOrphan, 'origin/main')
    const outside = join(repo.root, 'outside-worktree')
    repo.git(repo.clone, 'worktree', 'add', '--quiet', '-b', 'outside', outside, 'origin/main')
    rmSync(outside, { recursive: true, force: true })

    const report = await reclaimer!.reconcile()

    expect(report.closedLeases).toEqual([])
    expect([...report.removed].sort()).toEqual([cleanOrphan, deletedProjectOrphan, emptyOrphan].sort())
    expect(report.dirty).toEqual([{ path: dirtyOrphan, reason: '1 uncommitted change(s)' }])
    expect(report.pruned).toEqual([repo.clone])
    expect(existsSync(cleanOrphan)).toBe(false)
    expect(existsSync(emptyOrphan)).toBe(false)
    expect(existsSync(deletedProjectDir)).toBe(false)
    expect(existsSync(join(dirtyOrphan, 'unsaved.txt'))).toBe(true)
    expect(existsSync(leased.path)).toBe(true)
    const list = worktreeList()
    expect(list).not.toContain(cleanOrphan)
    expect(list).not.toContain(deletedProjectOrphan)
    expect(list).not.toContain(outside)
    expect(list).toContain(dirtyOrphan)
    expect(list).toContain(leased.path)
    expect(repo.git(repo.clone, 'branch', '--list', 'orphan-clean')).toContain('orphan-clean')
  }, 60_000)
})

describe('settings and platform', () => {
  it('reads the idle timeout and reclaim interval from the environment', () => {
    expect(resolveWorktreeSettings({ CM_WORKTREE_IDLE_TIMEOUT: '30m', CM_WORKTREE_RECLAIM_INTERVAL: '45s' })).toEqual({ maxPerProject: 4, idleTimeoutMs: 1_800_000, reclaimIntervalMs: 45_000 })
    expect(() => resolveWorktreeSettings({ CM_WORKTREE_IDLE_TIMEOUT: '2 hours' })).toThrow('CM_WORKTREE_IDLE_TIMEOUT')
    expect(() => resolveWorktreeSettings({ CM_WORKTREE_RECLAIM_INTERVAL: '0m' })).toThrow('CM_WORKTREE_RECLAIM_INTERVAL')
  })

  it('closes missing-path leases at startup and reclaims idle ones on the interval', async () => {
    repo = createTempGitRepo()
    let platform = startPlatform(data.root)
    const created = await createProject(platform.db, { name: 'beta', source: { kind: 'local-path', path: repo.clone } })
    const gone = await platform.worktrees.acquire({ projectId: created.id, holder: holder('gone'), baseBranch: 'main' })
    const idle = await platform.worktrees.acquire({ projectId: created.id, holder: holder('idle'), baseBranch: 'main' })
    await platform.worktreeReclaimer.ready
    platform.close()
    rmSync(gone.path, { recursive: true, force: true })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    platform = startPlatform(data.root, { worktrees: { idleTimeoutMs: HOUR, reclaimIntervalMs: 50 } })
    try {
      const report = await platform.worktreeReclaimer.ready
      expect(report?.closedLeases.map(lease => lease.id)).toEqual([gone.id])
      expect(platform.worktrees.get(gone.id)).toMatchObject({ state: 'released' })
      expect(logSpy).toHaveBeenCalledWith('Closed 1 worktree lease(s) whose directory was missing')

      platform.db.update(schema.worktreeLeases).set({ lastUsedAt: new Date(Date.now() - 2 * HOUR).toISOString() }).where(eq(schema.worktreeLeases.id, idle.id)).run()
      await vi.waitFor(() => expect(platform.worktrees.get(idle.id)).toMatchObject({ state: 'released' }), { timeout: 10_000, interval: 50 })
      expect(existsSync(idle.path)).toBe(false)
    }
    finally {
      platform.close()
      logSpy.mockRestore()
    }
  }, 30_000)
})
