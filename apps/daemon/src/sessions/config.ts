export const SESSION_IDLE_TIMEOUT_ENV = 'CM_SESSION_IDLE_TIMEOUT'
export const SESSION_MAX_LIVE_ENV = 'CM_SESSION_MAX_LIVE'
export const DEFAULT_SESSION_IDLE_TIMEOUT = '15m'
export const DEFAULT_SESSION_MAX_LIVE = 4
export const MAX_SESSION_IDLE_TIMEOUT_MS = 7 * 86_400_000

export interface SessionSettings {
  /** How long a live process may sit without a turn before it is killed; the session itself stays. */
  idleTimeoutMs: number
  /** Live processes allowed at once across every project; further prompts queue in order. */
  maxLive: number
}

const DURATION_UNITS_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

function parseDuration(name: string, value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  const ms = match ? Number(match[1]) * DURATION_UNITS_MS[match[2] as keyof typeof DURATION_UNITS_MS] : 0
  if (ms <= 0 || ms > MAX_SESSION_IDLE_TIMEOUT_MS) throw new Error(`${name} must be a duration such as 90s, 15m or 2h, at most 7d, got "${value}"`)
  return ms
}

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`)
  return n
}

export function resolveSessionSettings(env: NodeJS.ProcessEnv = process.env): SessionSettings {
  return {
    idleTimeoutMs: parseDuration(SESSION_IDLE_TIMEOUT_ENV, env[SESSION_IDLE_TIMEOUT_ENV] || DEFAULT_SESSION_IDLE_TIMEOUT),
    maxLive: parsePositiveInt(SESSION_MAX_LIVE_ENV, env[SESSION_MAX_LIVE_ENV], DEFAULT_SESSION_MAX_LIVE),
  }
}
