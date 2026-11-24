import type { ProductSettings } from '@crab-shack/platform-sdk'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** Candy Mountain's settings blocks by capability id; the daemon's environment variables override them (apps/daemon/README.md). */
export const CANDY_MOUNTAIN_SETTINGS = {
  'worktrees': { maxPerWorkspace: 4, idleTimeoutMs: 2 * HOUR, reclaimIntervalMs: 10 * MINUTE },
  'platform-agent': {
    about: 'Candy Mountain is a platform for managing codebases.',
    instructions: ['Say "issue", never "bead".'],
    avatar: 'i-lucide-mountain',
  },
} as const satisfies ProductSettings
