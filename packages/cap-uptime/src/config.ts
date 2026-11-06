export const UPTIME_HISTORY_MAX_ENV = 'CM_UPTIME_HISTORY_MAX'
export const UPTIME_HISTORY_MAX_AGE_ENV = 'CM_UPTIME_HISTORY_MAX_AGE'
export const DEFAULT_UPTIME_HISTORY_MAX = 500
export const DEFAULT_UPTIME_HISTORY_MAX_AGE = '30d'
const MAX_HISTORY_COUNT = 100_000
const MAX_HISTORY_AGE_MS = 366 * 86_400_000

export interface UptimeSettings {
  /** Stored checks kept per monitor; older ones are pruned as new ones land. */
  historyMax: number
  /** Stored checks older than this are pruned, whatever the count. */
  historyMaxAgeMs: number
}

const DURATION_UNITS_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

function parseDuration(name: string, value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  const ms = match ? Number(match[1]) * DURATION_UNITS_MS[match[2] as keyof typeof DURATION_UNITS_MS] : 0
  if (ms <= 0 || ms > MAX_HISTORY_AGE_MS) throw new Error(`${name} must be a duration such as 12h, 7d or 30d, at most 366d, got "${value}"`)
  return ms
}

function parseHistoryMax(value: string | undefined): number {
  if (!value) return DEFAULT_UPTIME_HISTORY_MAX
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0 || n > MAX_HISTORY_COUNT) throw new Error(`${UPTIME_HISTORY_MAX_ENV} must be a whole number from 1 to ${MAX_HISTORY_COUNT}, got "${value}"`)
  return n
}

export function resolveUptimeSettings(env: NodeJS.ProcessEnv = process.env): UptimeSettings {
  return {
    historyMax: parseHistoryMax(env[UPTIME_HISTORY_MAX_ENV]),
    historyMaxAgeMs: parseDuration(UPTIME_HISTORY_MAX_AGE_ENV, env[UPTIME_HISTORY_MAX_AGE_ENV] || DEFAULT_UPTIME_HISTORY_MAX_AGE),
  }
}
