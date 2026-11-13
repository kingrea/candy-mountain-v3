import type { SettingsOf, SettingsShape } from '@crab-shack/platform-sdk/daemon'

const MAX_DURATION_MS = 30 * 86_400_000

/** The product-level settings bots declares; the daemon checks a product's `bots` block against them at boot. */
export const BOTS_SETTINGS = {
  worktreesPerProject: { type: 'integer', default: 4, min: 1, description: 'Active worktree leases allowed per project; an acquire beyond it is refused, never queued.' },
  worktreeIdleTimeoutMs: { type: 'integer', default: 7_200_000, min: 1, max: MAX_DURATION_MS, description: 'A lease unused for this many milliseconds is reclaimed, unless its worktree holds uncommitted or unpushed work.' },
  worktreeReclaimIntervalMs: { type: 'integer', default: 600_000, min: 1, max: MAX_DURATION_MS, description: 'Milliseconds between idle reclaim passes.' },
} as const satisfies SettingsShape

export type BotsSettings = SettingsOf<typeof BOTS_SETTINGS>

export interface WorktreeSettings {
  /** Active worktree leases allowed per project; an acquire beyond it is refused, never queued. */
  maxPerProject: number
  /** A lease unused for this long is reclaimed, unless its worktree holds uncommitted or unpushed work. */
  idleTimeoutMs: number
  reclaimIntervalMs: number
}

export function worktreeSettings(settings: BotsSettings): WorktreeSettings {
  return { maxPerProject: settings.worktreesPerProject, idleTimeoutMs: settings.worktreeIdleTimeoutMs, reclaimIntervalMs: settings.worktreeReclaimIntervalMs }
}

export const DEFAULT_WORKTREE_SETTINGS: WorktreeSettings = worktreeSettings({
  worktreesPerProject: BOTS_SETTINGS.worktreesPerProject.default,
  worktreeIdleTimeoutMs: BOTS_SETTINGS.worktreeIdleTimeoutMs.default,
  worktreeReclaimIntervalMs: BOTS_SETTINGS.worktreeReclaimIntervalMs.default,
})
