export const WORKTREES_PER_PROJECT_ENV = 'CM_WORKTREES_PER_PROJECT'
export const WORKTREE_IDLE_TIMEOUT_ENV = 'CM_WORKTREE_IDLE_TIMEOUT'
export const WORKTREE_RECLAIM_INTERVAL_ENV = 'CM_WORKTREE_RECLAIM_INTERVAL'
export const DEFAULT_WORKTREES_PER_PROJECT = 4
export const DEFAULT_WORKTREE_IDLE_TIMEOUT = '2h'
export const DEFAULT_WORKTREE_RECLAIM_INTERVAL = '10m'
const MAX_DURATION_MS = 30 * 86_400_000

export interface WorktreeSettings {
  /** Active worktree leases allowed per project; an acquire beyond it is refused, never queued. */
  maxPerProject: number
  /** A lease unused for this long is reclaimed, unless its worktree holds uncommitted or unpushed work. */
  idleTimeoutMs: number
  reclaimIntervalMs: number
}

const DURATION_UNITS_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

function parseDuration(name: string, value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  const ms = match ? Number(match[1]) * DURATION_UNITS_MS[match[2] as keyof typeof DURATION_UNITS_MS] : 0
  if (ms <= 0 || ms > MAX_DURATION_MS) throw new Error(`${name} must be a duration such as 90s, 15m or 2h, at most 30d, got "${value}"`)
  return ms
}

function parseMaxPerProject(value: string | undefined): number {
  if (!value) return DEFAULT_WORKTREES_PER_PROJECT
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${WORKTREES_PER_PROJECT_ENV} must be a positive integer, got "${value}"`)
  return n
}

export function resolveWorktreeSettings(env: NodeJS.ProcessEnv = process.env): WorktreeSettings {
  return {
    maxPerProject: parseMaxPerProject(env[WORKTREES_PER_PROJECT_ENV]),
    idleTimeoutMs: parseDuration(WORKTREE_IDLE_TIMEOUT_ENV, env[WORKTREE_IDLE_TIMEOUT_ENV] || DEFAULT_WORKTREE_IDLE_TIMEOUT),
    reclaimIntervalMs: parseDuration(WORKTREE_RECLAIM_INTERVAL_ENV, env[WORKTREE_RECLAIM_INTERVAL_ENV] || DEFAULT_WORKTREE_RECLAIM_INTERVAL),
  }
}
