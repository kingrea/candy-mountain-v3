import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, eq, lte } from 'drizzle-orm'
import type { DataPaths } from '../data-dir'
import { schema, type Db } from '../db'
import { listProjects, sourcePath } from '../projects/projects'
import { resolveWorktreeSettings } from './config'
import { inspectWorktree } from './inspect'
import type { WorktreeLease, WorktreePool } from './pool'

export interface ReclaimResult {
  reclaimed: WorktreeLease[]
  /** Idle leases kept because their worktree holds uncommitted or unpushed work (see `unpushedReason`). */
  kept: WorktreeLease[]
  failed: { leaseId: string, error: string }[]
}

export interface ReconcileReport {
  /** Active leases whose directory had disappeared, now released. */
  closedLeases: WorktreeLease[]
  /** Directories under the worktrees root with no active lease that held nothing to lose. */
  removed: string[]
  /** Directories with no active lease that were left in place because removing them could lose work. */
  dirty: { path: string, reason: string }[]
  /** Project clones whose `git worktree prune` succeeded. */
  pruned: string[]
}

export interface WorktreeReclaimerDeps {
  db: Db
  paths: Pick<DataPaths, 'worktrees'>
  pool: WorktreePool
  now?: () => Date
  log?: Pick<Console, 'log' | 'warn' | 'error'>
}

export interface WorktreeReclaimerOptions {
  idleTimeoutMs?: number
  reclaimIntervalMs?: number
  /** Run `reconcile()` immediately; `ready` settles with its report. */
  reconcileOnStart?: boolean
}

export interface WorktreeReclaimer {
  /** The startup reconcile's report, or null when it was skipped, failed or cut short by close(). */
  ready: Promise<ReconcileReport | null>
  reclaimIdle(options?: { idleForMs?: number }): Promise<ReclaimResult>
  reconcile(): Promise<ReconcileReport>
  close(): void
}

const { worktreeLeases } = schema
const defaults = resolveWorktreeSettings({})

export function startWorktreeReclaimer({ db, paths, pool, now = () => new Date(), log = console }: WorktreeReclaimerDeps, { idleTimeoutMs = defaults.idleTimeoutMs, reclaimIntervalMs = defaults.reclaimIntervalMs, reconcileOnStart = true }: WorktreeReclaimerOptions = {}): WorktreeReclaimer {
  let closed = false

  const activeLeases = (projectId?: string) => db
    .select({ id: worktreeLeases.id, path: worktreeLeases.path })
    .from(worktreeLeases)
    .where(projectId === undefined ? eq(worktreeLeases.state, 'active') : and(eq(worktreeLeases.state, 'active'), eq(worktreeLeases.projectId, projectId)))
    .all()

  const reclaimIdle: WorktreeReclaimer['reclaimIdle'] = async ({ idleForMs = idleTimeoutMs } = {}) => {
    const result: ReclaimResult = { reclaimed: [], kept: [], failed: [] }
    const cutoff = new Date(now().getTime() - idleForMs).toISOString()
    const idle = db
      .select({ id: worktreeLeases.id, unpushedWork: worktreeLeases.unpushedWork })
      .from(worktreeLeases)
      .where(and(eq(worktreeLeases.state, 'active'), lte(worktreeLeases.lastUsedAt, cutoff)))
      .orderBy(asc(worktreeLeases.lastUsedAt))
      .all()
    for (const { id, unpushedWork } of idle) {
      if (closed) break
      try {
        const lease = await pool.release(id, { unusedSince: cutoff })
        if (lease.state === 'released') result.reclaimed.push(lease)
        else if (lease.unpushedWork) {
          result.kept.push(lease)
          if (!unpushedWork) log.warn(`Keeping idle worktree ${lease.path} (${lease.branch}): ${lease.unpushedReason}`)
        }
      }
      catch (error) {
        result.failed.push({ leaseId: id, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return result
  }

  async function sweep(path: string, report: ReconcileReport): Promise<void> {
    if ((await readdir(path)).length === 0) {
      await rm(path, { recursive: true, force: true })
      report.removed.push(path)
      return
    }
    const inspection = await inspectWorktree(pool.git, path)
    if (inspection.unsafeReason !== null) {
      report.dirty.push({ path, reason: inspection.unsafeReason })
      return
    }
    const commonDir = await pool.git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    await rm(path, { recursive: true, force: true })
    await pool.git(commonDir, ['worktree', 'prune']).catch(() => undefined)
    report.removed.push(path)
  }

  const reconcile: WorktreeReclaimer['reconcile'] = async () => {
    const report: ReconcileReport = { closedLeases: [], removed: [], dirty: [], pruned: [] }
    for (const { id, path } of activeLeases()) {
      if (closed) return report
      if (!existsSync(path)) report.closedLeases.push(await pool.release(id))
    }

    const projectDirs = await readdir(paths.worktrees, { withFileTypes: true }).catch(() => [])
    for (const projectDir of projectDirs) {
      if (closed) return report
      if (!projectDir.isDirectory()) continue
      const projectId = projectDir.name
      const dir = join(paths.worktrees, projectId)
      await pool.withProjectLock(projectId, async () => {
        const leased = new Set(activeLeases(projectId).map(lease => lease.path))
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (closed) return
          const path = join(dir, entry.name)
          if (!entry.isDirectory() || leased.has(path)) continue
          await sweep(path, report).catch((error: unknown) => {
            report.dirty.push({ path, reason: `Cannot inspect the directory: ${error instanceof Error ? error.message : String(error)}` })
          })
        }
        // acquire recreates the project directory whenever it needs it.
        if ((await readdir(dir)).length === 0) await rm(dir, { recursive: true, force: true })
      })
    }

    for (const project of listProjects(db, { includeArchived: true })) {
      if (closed) return report
      const clone = sourcePath(project.source)
      const ok = await pool.withProjectLock(project.id, () => pool.git(clone, ['worktree', 'prune']).then(() => true, () => false))
      if (ok) report.pruned.push(clone)
    }
    return report
  }

  const ready: Promise<ReconcileReport | null> = reconcileOnStart
    ? reconcile().then((report) => {
        if (closed) return null
        if (report.closedLeases.length > 0) log.log(`Closed ${report.closedLeases.length} worktree lease(s) whose directory was missing`)
        if (report.removed.length > 0) log.log(`Removed ${report.removed.length} unleased worktree directory(ies)`)
        for (const { path, reason } of report.dirty) log.warn(`Unleased worktree ${path} was kept: ${reason}`)
        return report
      }, (error: unknown) => {
        if (!closed) log.error('Worktree reconcile failed:', error)
        return null
      })
    : Promise.resolve(null)

  let running: Promise<unknown> | null = ready.finally(() => {
    running = null
  })
  const timer = setInterval(() => {
    if (closed || running) return
    running = reclaimIdle()
      .then((result) => {
        for (const { leaseId, error } of result.failed) log.warn(`Reclaiming worktree lease ${leaseId} failed: ${error}`)
      }, (error: unknown) => {
        if (!closed) log.error('Worktree reclaim failed:', error)
      })
      .finally(() => {
        running = null
      })
  }, reclaimIntervalMs)
  timer.unref()

  return {
    ready,
    reclaimIdle,
    reconcile,
    close() {
      closed = true
      clearInterval(timer)
    },
  }
}
