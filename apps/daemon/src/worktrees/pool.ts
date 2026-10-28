import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { and, asc, eq } from 'drizzle-orm'
import type { DataPaths } from '../data-dir'
import { schema, type Db } from '../db'
import type { WorktreeHolderKind, WorktreeLeaseState } from '../db/schema/worktree-leases'
import { findProjectById, sourcePath } from '../projects/projects'
import { DEFAULT_WORKTREES_PER_PROJECT, type WorktreeSettings } from './config'
import { WorktreeError } from './errors'
import { createGitRunner, GitError, type GitRunner } from './git'
import { inspectWorktree } from './inspect'
import { DEPENDENCY_INSTALL_TIMEOUT_MS, type DependencyInstaller, installWorktreeDependencies, type WorktreeDependencies } from './install'
import { createKeyedLock } from './lock'

export const FETCH_TIMEOUT_MS = 120_000
export const WORKTREE_BRANCH_PREFIX = 'cm'

export interface WorktreeHolder {
  kind: WorktreeHolderKind
  id: string
}

export interface WorktreeLease {
  id: string
  projectId: string
  holder: WorktreeHolder
  path: string
  branch: string
  baseBranch: string
  state: WorktreeLeaseState
  createdAt: string
  updatedAt: string
  lastUsedAt: string
  releasedAt: string | null
  /** Set when a release or reclaim found uncommitted or unpushed work and kept the worktree. */
  unpushedWork: boolean
  unpushedReason: string | null
  /** When the worktree was last checked for unpushed work. */
  inspectedAt: string | null
  /** Outcome of the last dependency install; null when none was attempted. */
  dependencies: WorktreeDependencies | null
}

export interface AcquireWorktreeRequest {
  projectId: string
  holder: WorktreeHolder
  baseBranch: string
  /** Defaults to `cm/<holder kind>/<holder id>`; bots should pass botBranchName(...). */
  branchName?: string
  /** Defaults to true; a failed install is recorded on the lease and never fails the acquire. */
  installDependencies?: boolean
}

export interface ResumeWorktreeOptions {
  /** Defaults to true; only applies when the worktree directory had vanished and was added back. */
  installDependencies?: boolean
}

export interface InstallDependenciesOptions {
  timeoutMs?: number
}

export interface ReleaseWorktreeOptions {
  /** Removes the worktree even if it holds uncommitted or unpushed work; only for an explicit human decision. */
  force?: boolean
  /** ISO time: leaves the lease untouched if it was used after this, so a reclaim cannot race a resume. */
  unusedSince?: string
}

export interface ListWorktreesOptions {
  includeReleased?: boolean
}

export interface WorktreePool {
  acquire(request: AcquireWorktreeRequest): Promise<WorktreeLease>
  resume(holder: WorktreeHolder, options?: ResumeWorktreeOptions): Promise<WorktreeLease | null>
  /** Keeps the lease active and flags it instead when the worktree holds uncommitted or unpushed work, unless forced. */
  release(leaseId: string, options?: ReleaseWorktreeOptions): Promise<WorktreeLease>
  list(projectId: string, options?: ListWorktreesOptions): WorktreeLease[]
  get(leaseId: string): WorktreeLease | null
  /** Installs the worktree's dependencies and records the outcome on the lease; a failure is recorded, not thrown. */
  installDependencies(leaseId: string, options?: InstallDependenciesOptions): Promise<WorktreeLease>
  /** Every git command that touches a project's clone or one of its worktrees must run inside this. */
  withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T>
  git: GitRunner
}

export interface WorktreePoolDeps {
  db: Db
  paths: Pick<DataPaths, 'worktrees'>
  git?: GitRunner
  now?: () => Date
  installer?: DependencyInstaller
}

export type WorktreePoolOptions = Partial<WorktreeSettings> & {
  dependencyInstallTimeoutMs?: number
}

const { worktreeLeases } = schema
type LeaseRow = typeof worktreeLeases.$inferSelect

export function botBranchName(botName: string, sessionId: string): string {
  const bot = botName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bot'
  return `${WORKTREE_BRANCH_PREFIX}/bot/${bot}/${sessionId}`
}

export function defaultBranchName(holder: WorktreeHolder): string {
  return `${WORKTREE_BRANCH_PREFIX}/${holder.kind}/${holder.id}`
}

export function createWorktreePool({ db, paths, git = createGitRunner(), now = () => new Date(), installer = installWorktreeDependencies }: WorktreePoolDeps, { maxPerProject = DEFAULT_WORKTREES_PER_PROJECT, dependencyInstallTimeoutMs = DEPENDENCY_INSTALL_TIMEOUT_MS }: WorktreePoolOptions = {}): WorktreePool {
  const lock = createKeyedLock()
  const withProjectLock = <T>(projectId: string, fn: () => Promise<T>) => lock(projectId, fn)

  const list: WorktreePool['list'] = (projectId, { includeReleased = false } = {}) => db
    .select()
    .from(worktreeLeases)
    .where(includeReleased ? eq(worktreeLeases.projectId, projectId) : and(eq(worktreeLeases.projectId, projectId), eq(worktreeLeases.state, 'active')))
    .orderBy(asc(worktreeLeases.createdAt), asc(worktreeLeases.id))
    .all()
    .map(toLease)

  const get: WorktreePool['get'] = (leaseId) => {
    const row = db.select().from(worktreeLeases).where(eq(worktreeLeases.id, leaseId)).get()
    return row ? toLease(row) : null
  }

  const findActive = (holder: WorktreeHolder): LeaseRow | undefined => db
    .select()
    .from(worktreeLeases)
    .where(and(eq(worktreeLeases.holderKind, holder.kind), eq(worktreeLeases.holderId, holder.id), eq(worktreeLeases.state, 'active')))
    .get()

  async function clonePathFor(projectId: string): Promise<string> {
    const project = findProjectById(db, projectId)
    if (!project) throw new WorktreeError('not_found', `Project ${projectId} does not exist`)
    const clone = sourcePath(project.source)
    const gitDir = await git(clone, ['rev-parse', '--git-dir']).catch(() => null)
    if (gitDir === null) throw new WorktreeError('clone_unavailable', `Project checkout ${clone} is missing or not a git repository`)
    return clone
  }

  async function validateBranchName(clone: string, name: string, what: string): Promise<void> {
    if (name === '' || name.startsWith('-') || /\s/.test(name)) throw new WorktreeError('invalid_request', `${what} "${name}" is not a valid git branch name`)
    const ok = await git(clone, ['check-ref-format', '--branch', name]).then(() => true, () => false)
    if (!ok) throw new WorktreeError('invalid_request', `${what} "${name}" is not a valid git branch name`)
  }

  async function refExists(clone: string, ref: string): Promise<boolean> {
    return git(clone, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then(() => true, (error) => {
      if (error instanceof GitError && error.exitCode === 1) return false
      throw error
    })
  }

  async function primaryRemote(clone: string): Promise<string | null> {
    const names = (await git(clone, ['remote'])).split('\n').filter(Boolean)
    return names.includes('origin') ? 'origin' : names[0] ?? null
  }

  async function resolveStartPoint(clone: string, baseBranch: string): Promise<string> {
    const remote = await primaryRemote(clone)
    if (remote === null) {
      if (!(await refExists(clone, `refs/heads/${baseBranch}`))) throw new WorktreeError('base_branch_not_found', `Base branch "${baseBranch}" does not exist in ${clone}`)
      return `refs/heads/${baseBranch}`
    }
    try {
      await git(clone, ['fetch', '--quiet', remote, baseBranch], { timeoutMs: FETCH_TIMEOUT_MS })
    }
    catch (error) {
      const stderr = error instanceof GitError ? error.stderr : ''
      if (/couldn't find remote ref|remote ref does not exist/i.test(stderr)) throw new WorktreeError('base_branch_not_found', `Base branch "${baseBranch}" does not exist on ${remote}`)
      throw new WorktreeError('fetch_failed', `Fetching ${baseBranch} from ${remote} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    const ref = `refs/remotes/${remote}/${baseBranch}`
    if (!(await refExists(clone, ref))) throw new WorktreeError('base_branch_not_found', `Base branch "${baseBranch}" was fetched but ${remote}/${baseBranch} is missing; check the remote's fetch refspec`)
    return ref
  }

  async function addWorktree(clone: string, path: string, branch: string, startPoint: string | null): Promise<void> {
    mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
    // --no-track: tracking origin/<base> would make a plain `git push` from the worktree refuse to push the bot's branch.
    const args = startPoint === null ? ['worktree', 'add', '--quiet', path, branch] : ['worktree', 'add', '--quiet', '--no-track', '-b', branch, path, startPoint]
    try {
      await git(clone, args)
    }
    catch (error) {
      rmSync(path, { recursive: true, force: true })
      throw new WorktreeError('git_failed', error instanceof Error ? error.message : String(error))
    }
  }

  // Runs outside the project lock: installs touch no git state and can take minutes, which would stall every other acquire and release.
  const installDependencies: WorktreePool['installDependencies'] = async (leaseId, { timeoutMs = dependencyInstallTimeoutMs } = {}) => {
    const lease = get(leaseId)
    if (!lease) throw new WorktreeError('not_found', `Worktree lease ${leaseId} does not exist`)
    if (lease.state === 'released') return lease
    const { status, output } = await installer(lease.path, { timeoutMs })
      .catch((error: unknown) => ({ status: 'failed' as const, output: `Dependency install crashed: ${error instanceof Error ? error.message : String(error)}` }))
    const checkedAt = now().toISOString()
    db.update(worktreeLeases).set({ dependenciesStatus: status, dependenciesOutput: output, dependenciesCheckedAt: checkedAt, updatedAt: checkedAt }).where(eq(worktreeLeases.id, leaseId)).run()
    return get(leaseId) ?? { ...lease, updatedAt: checkedAt, dependencies: { status, output, checkedAt } }
  }

  const acquire: WorktreePool['acquire'] = async ({ projectId, holder, baseBranch, branchName, installDependencies: install = true }) => {
    const branch = branchName ?? defaultBranchName(holder)
    if (branch === baseBranch) throw new WorktreeError('base_branch_refused', `A worktree may not be created on the base branch "${baseBranch}" itself`)
    const lease = await withProjectLock(projectId, async () => {
      const clone = await clonePathFor(projectId)
      await validateBranchName(clone, baseBranch, 'Base branch')
      await validateBranchName(clone, branch, 'Branch')
      if (findActive(holder)) throw new WorktreeError('lease_exists', `${holder.kind} ${holder.id} already holds an active worktree; resume it instead`)
      const active = list(projectId).length
      if (active >= maxPerProject) throw new WorktreeError('cap_reached', `Project already has ${active} of ${maxPerProject} allowed worktrees`)
      if (await refExists(clone, `refs/heads/${branch}`)) throw new WorktreeError('branch_exists', `Branch "${branch}" already exists in ${clone}`)

      const startPoint = await resolveStartPoint(clone, baseBranch)
      const id = randomUUID()
      const path = join(paths.worktrees, projectId, id)
      await addWorktree(clone, path, branch, startPoint)

      const at = now().toISOString()
      const row: LeaseRow = { id, projectId, holderKind: holder.kind, holderId: holder.id, path, branch, baseBranch, state: 'active', createdAt: at, updatedAt: at, lastUsedAt: at, releasedAt: null, unpushedWork: false, unpushedReason: null, inspectedAt: null, dependenciesStatus: null, dependenciesOutput: null, dependenciesCheckedAt: null }
      db.insert(worktreeLeases).values(row).run()
      return toLease(row)
    })
    return install ? installDependencies(lease.id) : lease
  }

  const resume: WorktreePool['resume'] = async (holder, { installDependencies: install = true } = {}) => {
    const found = findActive(holder)
    if (!found) return null
    let recreated = false
    const lease = await withProjectLock(found.projectId, async () => {
      const row = findActive(holder)
      if (!row) return null
      if (!existsSync(row.path)) {
        recreated = true
        const clone = await clonePathFor(row.projectId)
        // The admin entry still names the vanished directory and would block adding it back.
        await git(clone, ['worktree', 'prune'])
        const branchExists = await refExists(clone, `refs/heads/${row.branch}`)
        await addWorktree(clone, row.path, row.branch, branchExists ? null : await resolveStartPoint(clone, row.baseBranch))
      }
      const at = now().toISOString()
      db.update(worktreeLeases).set({ lastUsedAt: at, updatedAt: at }).where(eq(worktreeLeases.id, row.id)).run()
      return toLease({ ...row, lastUsedAt: at, updatedAt: at })
    })
    return lease && recreated && install ? installDependencies(lease.id) : lease
  }

  const release: WorktreePool['release'] = async (leaseId, { force = false, unusedSince } = {}) => {
    const found = get(leaseId)
    if (!found) throw new WorktreeError('not_found', `Worktree lease ${leaseId} does not exist`)
    if (found.state === 'released') return found
    return withProjectLock(found.projectId, async () => {
      const current = get(leaseId)
      if (!current || current.state === 'released') return current ?? found
      if (unusedSince !== undefined && current.lastUsedAt > unusedSince) return current
      if (!force) {
        const { unsafeReason } = await inspectWorktree(git, current.path)
        if (unsafeReason !== null) {
          const at = now().toISOString()
          const flags = { unpushedWork: true, unpushedReason: unsafeReason, inspectedAt: at, updatedAt: at }
          db.update(worktreeLeases).set(flags).where(eq(worktreeLeases.id, leaseId)).run()
          return { ...current, ...flags }
        }
      }
      const project = findProjectById(db, found.projectId)
      const clone = project ? sourcePath(project.source) : null
      if (clone !== null) {
        await git(clone, ['worktree', 'remove', '--force', found.path]).catch(() => undefined)
        await git(clone, ['worktree', 'prune']).catch(() => undefined)
      }
      // Whatever git could not clean up (a deleted clone, a locked worktree) must not keep the slot.
      rmSync(found.path, { recursive: true, force: true })
      const at = now().toISOString()
      const released = { state: 'released' as const, releasedAt: at, updatedAt: at, unpushedWork: false, unpushedReason: null, inspectedAt: force ? current.inspectedAt : at }
      db.update(worktreeLeases).set(released).where(eq(worktreeLeases.id, leaseId)).run()
      return { ...current, ...released }
    })
  }

  return { acquire, resume, release, list, get, installDependencies, withProjectLock, git }
}

function toLease(row: LeaseRow): WorktreeLease {
  return {
    id: row.id,
    projectId: row.projectId,
    holder: { kind: row.holderKind, id: row.holderId },
    path: row.path,
    branch: row.branch,
    baseBranch: row.baseBranch,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
    releasedAt: row.releasedAt,
    unpushedWork: row.unpushedWork,
    unpushedReason: row.unpushedReason,
    inspectedAt: row.inspectedAt,
    dependencies: row.dependenciesStatus === null || row.dependenciesCheckedAt === null
      ? null
      : { status: row.dependenciesStatus, output: row.dependenciesOutput, checkedAt: row.dependenciesCheckedAt },
  }
}
