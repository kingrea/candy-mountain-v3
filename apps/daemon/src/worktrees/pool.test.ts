import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlatformDatabase } from '../db'
import { startPlatform } from '../platform'
import { createProject, deleteProject } from '../projects/projects'
import { createTempDataDir, openTestDatabase, type TempDataDir } from '../testing'
import { resolveWorktreeSettings } from './config'
import { WorktreeError } from './errors'
import { createGitRunner, GitError } from './git'
import { createKeyedLock } from './lock'
import { botBranchName, createWorktreePool, type WorktreeHolder, type WorktreePool } from './pool'
import { createTempGitRepo, TEST_GIT_ENV, type TempGitRepo } from './test-repo'

let database: PlatformDatabase
let repo: TempGitRepo
let data: TempDataDir
let pool: WorktreePool
let project: Project

const holder = (id: string): WorktreeHolder => ({ kind: 'session', id })
const gitRunner = createGitRunner({ env: TEST_GIT_ENV })

async function setUp({ remote = true, maxPerProject = 4 }: { remote?: boolean, maxPerProject?: number } = {}) {
  repo = createTempGitRepo({ remote })
  project = await createProject(database.db, { name: 'alpha', source: { kind: 'local-path', path: repo.clone } })
  pool = createWorktreePool({ db: database.db, paths: { worktrees: join(data.root, 'worktrees') }, git: gitRunner }, { maxPerProject })
}

function cloneState() {
  return {
    branch: repo.git(repo.clone, 'rev-parse', '--abbrev-ref', 'HEAD'),
    head: repo.git(repo.clone, 'rev-parse', 'HEAD'),
    status: repo.git(repo.clone, 'status', '--porcelain'),
  }
}

beforeEach(() => {
  database = openTestDatabase()
  data = createTempDataDir()
})
afterEach(() => {
  database.close()
  repo?.cleanup()
  data.cleanup()
})

async function failure(promise: Promise<unknown>): Promise<WorktreeError> {
  try {
    await promise
  }
  catch (error) {
    if (error instanceof WorktreeError) return error
    throw error
  }
  throw new Error('expected a WorktreeError')
}

describe('acquire', () => {
  it('creates a worktree on a fresh branch cut from the fetched base', async () => {
    await setUp()
    const latest = repo.pushToOrigin('after-clone.txt', 'new\n')
    const before = cloneState()

    const lease = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })

    expect(lease).toMatchObject({ projectId: project.id, holder: { kind: 'session', id: 's1' }, branch: 'cm/session/s1', baseBranch: 'main', state: 'active', releasedAt: null })
    expect(lease.path).toBe(join(data.root, 'worktrees', project.id, lease.id))
    expect(existsSync(join(lease.path, 'after-clone.txt'))).toBe(true)
    expect(repo.git(lease.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('cm/session/s1')
    expect(repo.git(lease.path, 'rev-parse', 'HEAD')).toBe(latest)
    expect(() => repo.git(lease.path, 'config', '--get', 'branch.cm/session/s1.remote')).toThrow()
    expect(repo.git(repo.clone, 'worktree', 'list', '--porcelain')).toContain(`worktree ${lease.path}`)
    expect(cloneState()).toEqual(before)
    expect(pool.list(project.id)).toEqual([lease])
    expect(pool.get(lease.id)).toEqual(lease)
  }, 20_000)

  it('leaves the main checkout alone across acquire and release, even when dirty', async () => {
    await setUp()
    writeFileSync(join(repo.clone, 'scratch.txt'), 'uncommitted\n')
    const before = cloneState()
    expect(before.status).toContain('scratch.txt')

    const lease = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    expect(cloneState()).toEqual(before)
    await pool.release(lease.id)
    expect(cloneState()).toEqual(before)
  })

  it('uses the local base branch when the clone has no remote', async () => {
    await setUp({ remote: false })
    const lease = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    expect(repo.git(lease.path, 'rev-parse', 'HEAD')).toBe(repo.git(repo.clone, 'rev-parse', 'main'))
    expect(await failure(pool.acquire({ projectId: project.id, holder: holder('s2'), baseBranch: 'nope' }))).toMatchObject({ code: 'base_branch_not_found' })
  })

  it('accepts a bot branch name that identifies the bot and session', async () => {
    await setUp()
    const branch = botBranchName('Fix Bot (EU)', 'sess-1')
    expect(branch).toBe('cm/bot/fix-bot-eu/sess-1')
    const lease = await pool.acquire({ projectId: project.id, holder: holder('sess-1'), baseBranch: 'main', branchName: branch })
    expect(repo.git(lease.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(branch)
  })

  it('refuses the base branch as the target branch', async () => {
    await setUp()
    const error = await failure(pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main', branchName: 'main' }))
    expect(error).toMatchObject({ code: 'base_branch_refused', status: 422 })
    expect(pool.list(project.id)).toEqual([])
  })

  it('refuses beyond the per-project cap until a lease is released', async () => {
    await setUp({ maxPerProject: 2 })
    const first = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    await pool.acquire({ projectId: project.id, holder: holder('s2'), baseBranch: 'main' })
    const error = await failure(pool.acquire({ projectId: project.id, holder: holder('s3'), baseBranch: 'main' }))
    expect(error).toMatchObject({ code: 'cap_reached', status: 409 })
    expect(pool.list(project.id)).toHaveLength(2)

    await pool.release(first.id)
    const third = await pool.acquire({ projectId: project.id, holder: holder('s3'), baseBranch: 'main' })
    expect(pool.list(project.id).map(l => l.id)).not.toContain(first.id)
    expect(pool.list(project.id).map(l => l.id)).toContain(third.id)
  }, 20_000)

  it('refuses a second active lease for the same holder and a branch that already exists', async () => {
    await setUp()
    await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    expect(await failure(pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main', branchName: 'other' }))).toMatchObject({ code: 'lease_exists' })
    expect(await failure(pool.acquire({ projectId: project.id, holder: holder('s2'), baseBranch: 'main', branchName: 'cm/session/s1' }))).toMatchObject({ code: 'branch_exists' })
    expect(pool.list(project.id)).toHaveLength(1)
  })

  it('rejects bad names, unknown projects, missing base branches and non-git checkouts', async () => {
    await setUp()
    expect(await failure(pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main', branchName: 'bad name' }))).toMatchObject({ code: 'invalid_request' })
    expect(await failure(pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: '-x', branchName: 'ok' }))).toMatchObject({ code: 'invalid_request' })
    expect(await failure(pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'nope' }))).toMatchObject({ code: 'base_branch_not_found' })
    expect(await failure(pool.acquire({ projectId: 'missing', holder: holder('s1'), baseBranch: 'main' }))).toMatchObject({ code: 'not_found' })
    const plain = await createProject(database.db, { name: 'plain', source: { kind: 'local-path', path: repo.root } })
    expect(await failure(pool.acquire({ projectId: plain.id, holder: holder('s1'), baseBranch: 'main' }))).toMatchObject({ code: 'clone_unavailable' })
    expect(pool.list(project.id)).toEqual([])
  })

  it('serialises concurrent acquires on one clone', async () => {
    await setUp()
    const leases = await Promise.all(['a', 'b', 'c'].map(id => pool.acquire({ projectId: project.id, holder: holder(id), baseBranch: 'main' })))
    expect(new Set(leases.map(l => l.path)).size).toBe(3)
    for (const lease of leases) expect(repo.git(lease.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(lease.branch)
    expect(pool.list(project.id).map(l => l.holder.id)).toEqual(['a', 'b', 'c'])
  }, 20_000)
})

describe('resume', () => {
  it('returns the same path for the holder and nothing for strangers or released leases', async () => {
    await setUp()
    const lease = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    const resumed = await pool.resume(holder('s1'))
    expect(resumed).toMatchObject({ id: lease.id, path: lease.path, branch: lease.branch })
    expect(resumed!.lastUsedAt >= lease.lastUsedAt).toBe(true)
    expect(await pool.resume(holder('s2'))).toBeNull()
    expect(await pool.resume({ kind: 'bot', id: 's1' })).toBeNull()
    await pool.release(lease.id)
    expect(await pool.resume(holder('s1'))).toBeNull()
  })

  it('recreates a vanished directory on the lease branch, keeping its commits', async () => {
    await setUp()
    const lease = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    writeFileSync(join(lease.path, 'work.txt'), 'done\n')
    repo.git(lease.path, 'add', 'work.txt')
    repo.git(lease.path, 'commit', '--quiet', '-m', 'work')
    const sha = repo.git(lease.path, 'rev-parse', 'HEAD')
    rmSync(lease.path, { recursive: true, force: true })

    const resumed = await pool.resume(holder('s1'))
    expect(resumed!.path).toBe(lease.path)
    expect(repo.git(lease.path, 'rev-parse', 'HEAD')).toBe(sha)
    expect(repo.git(lease.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(lease.branch)
  })

  it('recreates from the base again when the branch is gone too', async () => {
    await setUp()
    const lease = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    rmSync(lease.path, { recursive: true, force: true })
    repo.git(repo.clone, 'worktree', 'prune')
    repo.git(repo.clone, 'branch', '-D', lease.branch)

    const resumed = await pool.resume(holder('s1'))
    expect(resumed!.path).toBe(lease.path)
    expect(repo.git(lease.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(lease.branch)
    expect(repo.git(lease.path, 'rev-parse', 'HEAD')).toBe(repo.git(repo.clone, 'rev-parse', 'origin/main'))
  })
})

describe('release', () => {
  it('removes the directory, keeps the branch and marks the lease released', async () => {
    await setUp()
    const lease = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    const released = await pool.release(lease.id)
    expect(released).toMatchObject({ id: lease.id, state: 'released' })
    expect(released.releasedAt).not.toBeNull()
    expect(existsSync(lease.path)).toBe(false)
    expect(repo.git(repo.clone, 'worktree', 'list', '--porcelain')).not.toContain(lease.path)
    expect(repo.git(repo.clone, 'branch', '--list', lease.branch)).toContain(lease.branch)
    expect(pool.list(project.id)).toEqual([])
    expect(pool.list(project.id, { includeReleased: true })).toEqual([released])
    expect(await pool.release(lease.id)).toEqual(released)
    expect(await failure(pool.release('missing'))).toMatchObject({ code: 'not_found', status: 404 })
  })

  it('keeps an uninspectable worktree when the clone is gone unless forced, and rows cascade with the project', async () => {
    await setUp()
    const lease = await pool.acquire({ projectId: project.id, holder: holder('s1'), baseBranch: 'main' })
    const other = await pool.acquire({ projectId: project.id, holder: holder('s2'), baseBranch: 'main' })
    rmSync(repo.clone, { recursive: true, force: true })
    expect(await pool.release(lease.id)).toMatchObject({ state: 'active', unpushedWork: true, unpushedReason: expect.stringContaining('Cannot inspect') })
    expect(existsSync(lease.path)).toBe(true)
    expect(await pool.release(lease.id, { force: true })).toMatchObject({ state: 'released', unpushedWork: false })
    expect(existsSync(lease.path)).toBe(false)

    deleteProject(database.db, project.slug)
    expect(pool.get(other.id)).toBeNull()
    expect(pool.list(project.id, { includeReleased: true })).toEqual([])
  })
})

describe('git runner', () => {
  it('reports failures with stderr and exit code, and kills on timeout', async () => {
    await setUp()
    await expect(gitRunner(repo.clone, ['rev-parse', '--verify', '--quiet', 'refs/heads/nope'])).rejects.toMatchObject({ exitCode: 1, timedOut: false })
    const error = await gitRunner(repo.clone, ['checkout', 'nope']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).stderr).toContain('nope')
    const hooks = join(repo.root, 'hooks')
    mkdirSync(hooks)
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
    const started = Date.now()
    const slow = await gitRunner(repo.clone, ['-c', `core.hooksPath=${hooks}`, 'commit', '--allow-empty', '-m', 'slow'], { timeoutMs: 200 }).catch((e: unknown) => e)
    expect(slow).toMatchObject({ timedOut: true, exitCode: null })
    expect(Date.now() - started).toBeLessThan(3000)
  })
})

describe('keyed lock', () => {
  it('runs same-key callers one at a time in order and other keys independently', async () => {
    const lock = createKeyedLock()
    const log: string[] = []
    let running = 0
    const task = (key: string, name: string, ms: number) => lock(key, async () => {
      running += 1
      expect(running).toBeLessThanOrEqual(2)
      log.push(`${name}:start`)
      await new Promise(resolve => setTimeout(resolve, ms))
      log.push(`${name}:end`)
      running -= 1
    })
    await Promise.all([task('p', 'a', 20), task('p', 'b', 5), task('q', 'c', 1), task('p', 'd', 1)])
    expect(log.filter(e => !e.startsWith('c'))).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'd:start', 'd:end'])
    expect(log.indexOf('c:end')).toBeLessThan(log.indexOf('a:end'))
    await expect(lock('p', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(lock('p', async () => 'after')).resolves.toBe('after')
  })
})

describe('settings and platform', () => {
  it('reads the cap from the environment', () => {
    expect(resolveWorktreeSettings({})).toEqual({ maxPerProject: 4, idleTimeoutMs: 7_200_000, reclaimIntervalMs: 600_000 })
    expect(resolveWorktreeSettings({ CM_WORKTREES_PER_PROJECT: '2' })).toMatchObject({ maxPerProject: 2 })
    expect(() => resolveWorktreeSettings({ CM_WORKTREES_PER_PROJECT: '0' })).toThrow('CM_WORKTREES_PER_PROJECT')
    expect(() => resolveWorktreeSettings({ CM_WORKTREES_PER_PROJECT: 'two' })).toThrow('CM_WORKTREES_PER_PROJECT')
  })

  it('exposes the pool on the platform under the data directory', async () => {
    const platform = startPlatform(data.root, { worktrees: { maxPerProject: 1 } })
    try {
      repo = createTempGitRepo()
      const created = await createProject(platform.db, { name: 'beta', source: { kind: 'local-path', path: repo.clone } })
      const lease = await platform.worktrees.acquire({ projectId: created.id, holder: holder('s1'), baseBranch: 'main' })
      expect(lease.path).toBe(join(platform.paths.worktrees, created.id, lease.id))
      expect(await failure(platform.worktrees.acquire({ projectId: created.id, holder: holder('s2'), baseBranch: 'main' }))).toMatchObject({ code: 'cap_reached' })
    }
    finally {
      platform.close()
    }
  })
})
