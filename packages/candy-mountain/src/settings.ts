import type { ProductSettings } from '@crab-shack/platform-sdk'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Candy Mountain's settings blocks by capability id; the daemon's environment variables override them (apps/daemon/README.md). */
export const CANDY_MOUNTAIN_SETTINGS = {
  bots: { worktreesPerProject: 4, worktreeIdleTimeoutMs: 2 * HOUR, worktreeReclaimIntervalMs: 10 * MINUTE },
} as const satisfies ProductSettings
