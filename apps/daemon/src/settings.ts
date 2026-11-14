import { BOTS_SETTINGS } from '@crab-shack/cap-bots'
import { CANDY_MOUNTAIN_SETTINGS } from '@candy-mountain/candy-mountain'
import { ProductError } from '@crab-shack/platform-daemon'
import type { ProductSettings } from '@crab-shack/platform-sdk'
import { settingValueProblem } from '@crab-shack/platform-sdk/daemon'

const DURATION_UNITS_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const
const DURATION = 'a duration such as 90s, 15m or 2h, at most 30d'

function durationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  return match ? Number(match[1]) * DURATION_UNITS_MS[match[2] as keyof typeof DURATION_UNITS_MS] : Number.NaN
}

interface SettingVariable {
  name: string
  key: keyof typeof BOTS_SETTINGS
  expected: string
  parse(value: string): number
}

/** Deployments set these before bots declared its settings, so they keep their names and formats and win over the product's values. */
export const BOTS_SETTING_VARIABLES: readonly SettingVariable[] = [
  { name: 'CM_WORKTREES_PER_PROJECT', key: 'worktreesPerProject', expected: 'a positive integer', parse: Number },
  { name: 'CM_WORKTREE_IDLE_TIMEOUT', key: 'worktreeIdleTimeoutMs', expected: DURATION, parse: durationMs },
  { name: 'CM_WORKTREE_RECLAIM_INTERVAL', key: 'worktreeReclaimIntervalMs', expected: DURATION, parse: durationMs },
]

/** The product's settings with any environment overrides applied; an empty variable leaves the product's value. */
export function candyMountainSettings(env: NodeJS.ProcessEnv = {}): ProductSettings {
  const bots: Record<string, number> = { ...CANDY_MOUNTAIN_SETTINGS.bots }
  for (const { name, key, expected, parse } of BOTS_SETTING_VARIABLES) {
    const raw = env[name]
    if (!raw) continue
    const value = parse(raw)
    if (settingValueProblem(BOTS_SETTINGS[key], value)) throw new ProductError(`Capability 'bots' setting '${key}': ${name} must be ${expected}, got "${raw}".`)
    bots[key] = value
  }
  return { ...CANDY_MOUNTAIN_SETTINGS, bots }
}
