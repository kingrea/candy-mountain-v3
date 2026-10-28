import { createHash } from 'node:crypto'
import { statSync, watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from '../db'
import { listProjects, sourcePath } from '../projects'
import { invalidateIssueList } from './service'

export const ISSUE_WATCH_DEBOUNCE_MS = 250
export const ISSUE_WATCH_MAX_WAIT_MS = 1000
// Each bd write is its own process, so a scripted burst arrives as many separate writes rather than one flurry.
export const ISSUE_WATCH_MIN_INTERVAL_MS = 2000
export const ISSUE_WATCH_RECONCILE_MS = 2000

const DOLT_SEARCH_DEPTH = 3
// Dolt's chunk journal file name is fixed.
const DOLT_JOURNAL = 'v'.repeat(32)

export type IssueChangeListener = () => void

export interface IssueWatcherOptions {
  db: Db
  invalidate?: (projectId: string) => void
  debounceMs?: number
  maxWaitMs?: number
  minIntervalMs?: number
  reconcileMs?: number
}

export interface IssueWatcher {
  /** Every subscriber of a project shares that project's single filesystem watch. */
  subscribe(projectId: string, listener: IssueChangeListener): () => void
  isWatching(projectId: string): boolean
  /** Syncs watches with the active project list and each checkout's .beads directory; also runs on a timer. */
  reconcile(): void
  /** Aborted by close() so open event streams can end. */
  readonly signal: AbortSignal
  close(): void
}

interface WatchTiming {
  debounceMs: number
  maxWaitMs: number
  minIntervalMs: number
}

function directoryInode(path: string): number | null {
  try {
    const stats = statSync(path)
    return stats.isDirectory() ? stats.ino : null
  }
  catch {
    return null
  }
}

async function findDoltDirectories(dir: string, depth = 0): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name)
    if (entry.name === '.dolt') found.push(path)
    else if (depth < DOLT_SEARCH_DEPTH) found.push(...await findDoltDirectories(path, depth + 1))
  }
  return found
}

/**
 * Summarises the tracker's stored state. bd rewrites Dolt files on every read, so raw file events cannot tell a
 * read from a write; the manifest's root hash and the journal length only move when data is committed.
 */
export async function beadsFingerprint(beadsDir: string): Promise<string> {
  const hash = createHash('sha1')
  hash.update(await readFile(join(beadsDir, 'issues.jsonl')).catch(() => ''))
  for (const dolt of (await findDoltDirectories(beadsDir)).sort()) {
    const noms = join(dolt, 'noms')
    hash.update(dolt)
    hash.update(await readFile(join(noms, 'manifest')).catch(() => ''))
    hash.update(String(await stat(join(noms, DOLT_JOURNAL)).then(s => s.size, () => -1)))
  }
  return hash.digest('hex')
}

class BeadsDirectoryWatch {
  readonly beadsDir: string
  private watcher: FSWatcher | null = null
  private inode: number | null = null
  private watchFailed = false
  private fingerprint: string | undefined
  private timer: NodeJS.Timeout | null = null
  private burstStartedAt: number | null = null
  private notifyTimer: NodeJS.Timeout | null = null
  private notifiedAt = -Infinity
  private checking = false
  private recheck = false
  private closed = false

  constructor(readonly cwd: string, private readonly timing: WatchTiming, private readonly onChange: () => void) {
    this.beadsDir = join(cwd, '.beads')
    this.sync()
    void this.check()
  }

  get active(): boolean {
    return this.watcher !== null
  }

  /** Picks up the directory appearing, disappearing or being replaced, none of which a recursive watch reports. */
  refresh(): void {
    if (this.sync() || this.watchFailed) this.schedule()
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.stopWatching()
  }

  private sync(): boolean {
    const inode = directoryInode(this.beadsDir)
    if (inode === this.inode) return false
    this.stopWatching()
    this.inode = inode
    if (inode !== null) this.startWatching()
    return true
  }

  private startWatching(): void {
    try {
      this.watcher = watch(this.beadsDir, { recursive: true, persistent: false }, () => this.schedule())
      this.watcher.on('error', () => {
        this.stopWatching()
        this.inode = null
        this.schedule()
      })
      this.watchFailed = false
    }
    catch (error) {
      // Typically the inotify watch limit; refresh() then polls the fingerprint instead.
      if (!this.watchFailed) console.warn(`Cannot watch ${this.beadsDir}: ${(error as Error).message}`)
      this.watchFailed = true
    }
  }

  private stopWatching(): void {
    this.watcher?.close()
    this.watcher = null
  }

  private schedule(): void {
    if (this.closed) return
    const now = Date.now()
    this.burstStartedAt ??= now
    if (this.timer) clearTimeout(this.timer)
    const wait = Math.min(this.timing.debounceMs, Math.max(0, this.burstStartedAt + this.timing.maxWaitMs - now))
    this.timer = setTimeout(() => {
      this.timer = null
      this.burstStartedAt = null
      void this.check()
    }, wait)
    this.timer.unref()
  }

  private notify(): void {
    if (this.notifyTimer) return
    const fire = () => {
      this.notifyTimer = null
      this.notifiedAt = Date.now()
      if (!this.closed) this.onChange()
    }
    const wait = this.notifiedAt + this.timing.minIntervalMs - Date.now()
    if (wait <= 0) {
      fire()
      return
    }
    this.notifyTimer = setTimeout(fire, wait)
    this.notifyTimer.unref()
  }

  private async check(): Promise<void> {
    if (this.checking) {
      this.recheck = true
      return
    }
    this.checking = true
    try {
      do {
        this.recheck = false
        this.sync()
        const next = this.inode === null ? '' : await beadsFingerprint(this.beadsDir)
        if (this.closed) return
        const previous = this.fingerprint
        this.fingerprint = next
        if (previous !== undefined && previous !== next) this.notify()
      } while (this.recheck)
    }
    catch (error) {
      console.error(`Issue watch check failed for ${this.beadsDir}:`, error)
    }
    finally {
      this.checking = false
    }
  }
}

export function startIssueWatcher(options: IssueWatcherOptions): IssueWatcher {
  const invalidate = options.invalidate ?? invalidateIssueList
  const timing: WatchTiming = {
    debounceMs: options.debounceMs ?? ISSUE_WATCH_DEBOUNCE_MS,
    maxWaitMs: options.maxWaitMs ?? ISSUE_WATCH_MAX_WAIT_MS,
    minIntervalMs: options.minIntervalMs ?? ISSUE_WATCH_MIN_INTERVAL_MS,
  }
  const watches = new Map<string, BeadsDirectoryWatch>()
  const listeners = new Map<string, Set<IssueChangeListener>>()
  const controller = new AbortController()

  function changed(projectId: string): void {
    invalidate(projectId)
    for (const listener of listeners.get(projectId) ?? []) listener()
  }

  function reconcile(): void {
    if (controller.signal.aborted) return
    const active = new Map(listProjects(options.db).map(project => [project.id, sourcePath(project.source)]))
    for (const [projectId, existing] of watches) {
      if (active.get(projectId) === existing.cwd) continue
      existing.close()
      watches.delete(projectId)
      if (active.has(projectId)) changed(projectId)
    }
    for (const [projectId, cwd] of active) {
      const existing = watches.get(projectId)
      if (existing) {
        existing.refresh()
        continue
      }
      watches.set(projectId, new BeadsDirectoryWatch(cwd, timing, () => changed(projectId)))
    }
  }

  reconcile()
  const interval = setInterval(() => {
    try {
      reconcile()
    }
    catch (error) {
      console.error('Issue watcher reconcile failed:', error)
    }
  }, options.reconcileMs ?? ISSUE_WATCH_RECONCILE_MS)
  interval.unref()

  return {
    subscribe(projectId, listener) {
      let set = listeners.get(projectId)
      if (!set) listeners.set(projectId, set = new Set())
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0 && listeners.get(projectId) === set) listeners.delete(projectId)
      }
    },

    isWatching(projectId) {
      return watches.get(projectId)?.active ?? false
    },

    reconcile,

    signal: controller.signal,

    close() {
      if (controller.signal.aborted) return
      controller.abort()
      clearInterval(interval)
      for (const existing of watches.values()) existing.close()
      watches.clear()
      listeners.clear()
    },
  }
}
