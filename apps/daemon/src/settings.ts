import { WORKTREES_SETTINGS } from '@crab-shack/plugin-worktrees'
import { CANDY_MOUNTAIN_SETTINGS } from '@candy-mountain/candy-mountain'
import { ProductError } from '@crab-shack/platform-daemon'
import { DECISION_RENAMED_VARIABLES, INSTRUCTION_RENAMED_VARIABLES, SESSION_RENAMED_VARIABLES } from '@crab-shack/plugin-acp'
import { UPTIME_RENAMED_VARIABLES } from '@crab-shack/plugin-uptime'
import { PLATFORM_RENAMED_VARIABLES, refuseRenamedVariables, type ProductSettings, type RenamedVariables } from '@crab-shack/platform-sdk'
import { settingValueProblem } from '@crab-shack/platform-sdk/daemon'

const DURATION_UNITS_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const
const DURATION = 'a duration such as 90s, 15m or 2h, at most 30d'

function durationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  return match ? Number(match[1]) * DURATION_UNITS_MS[match[2] as keyof typeof DURATION_UNITS_MS] : Number.NaN
}

interface SettingVariable {
  name: string
  key: keyof typeof WORKTREES_SETTINGS
  expected: string
  parse(value: string): number
}

/** Deployments set these before the settings were declared, so they keep their formats and win over the product's values. */
export const WORKTREES_SETTING_VARIABLES: readonly SettingVariable[] = [
  { name: 'CRAB_WORKTREES_PER_PROJECT', key: 'maxPerWorkspace', expected: 'a positive integer', parse: Number },
  { name: 'CRAB_WORKTREE_IDLE_TIMEOUT', key: 'idleTimeoutMs', expected: DURATION, parse: durationMs },
  { name: 'CRAB_WORKTREE_RECLAIM_INTERVAL', key: 'reclaimIntervalMs', expected: DURATION, parse: durationMs },
]

/** Candy Mountain's own variables that started CM_ until it moved to platform 0.30.0. */
export const CANDY_MOUNTAIN_RENAMED_VARIABLES: RenamedVariables = {
  CM_WORKTREES_PER_PROJECT: 'CRAB_WORKTREES_PER_PROJECT',
  CM_WORKTREE_IDLE_TIMEOUT: 'CRAB_WORKTREE_IDLE_TIMEOUT',
  CM_WORKTREE_RECLAIM_INTERVAL: 'CRAB_WORKTREE_RECLAIM_INTERVAL',
}

/**
 * Every old name the daemon would otherwise meet one at a time, refused in one list before the platform opens the data directory:
 * plugin-acp and plugin-uptime refuse theirs only when their definitions start, after the migrations have run.
 */
export const RENAMED_VARIABLES: RenamedVariables = {
  ...PLATFORM_RENAMED_VARIABLES,
  ...SESSION_RENAMED_VARIABLES,
  ...INSTRUCTION_RENAMED_VARIABLES,
  ...DECISION_RENAMED_VARIABLES,
  ...UPTIME_RENAMED_VARIABLES,
  ...CANDY_MOUNTAIN_RENAMED_VARIABLES,
}

/** The product's settings with any environment overrides applied; an empty variable leaves the product's value. */
export function candyMountainSettings(env: NodeJS.ProcessEnv = {}): ProductSettings {
  refuseRenamedVariables(env, CANDY_MOUNTAIN_RENAMED_VARIABLES)
  const worktrees: Record<string, number> = { ...CANDY_MOUNTAIN_SETTINGS.worktrees }
  for (const { name, key, expected, parse } of WORKTREES_SETTING_VARIABLES) {
    const raw = env[name]
    if (!raw) continue
    const value = parse(raw)
    if (settingValueProblem(WORKTREES_SETTINGS[key], value)) throw new ProductError(`Capability 'worktrees' setting '${key}': ${name} must be ${expected}, got "${raw}".`)
    worktrees[key] = value
  }
  return { ...CANDY_MOUNTAIN_SETTINGS, worktrees }
}
