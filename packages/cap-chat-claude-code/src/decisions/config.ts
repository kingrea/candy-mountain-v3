export const DECISION_TIMEOUT_ENV = 'CM_DECISION_TIMEOUT'
export const DEFAULT_DECISION_TIMEOUT = '5m'
export const MAX_DECISION_TIMEOUT_MS = 86_400_000

export interface DecisionSettings {
  /** How long a decision waits for an answer before it is refused on the human's behalf. */
  timeoutMs: number
}

const DURATION_UNITS_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

export function resolveDecisionSettings(env: NodeJS.ProcessEnv = process.env): DecisionSettings {
  const value = env[DECISION_TIMEOUT_ENV] || DEFAULT_DECISION_TIMEOUT
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  const ms = match ? Number(match[1]) * DURATION_UNITS_MS[match[2] as keyof typeof DURATION_UNITS_MS] : 0
  if (ms <= 0 || ms > MAX_DECISION_TIMEOUT_MS) throw new Error(`${DECISION_TIMEOUT_ENV} must be a duration such as 90s, 5m or 2h, at most 1d, got "${value}"`)
  return { timeoutMs: ms }
}
