import { AUTH_STRATEGY_NAMES, isAuthStrategyName } from '@candy-mountain/shared'

export const AUTH_STRATEGY_ENV = 'CM_AUTH_STRATEGY'
export const TRUSTED_HEADER_ENV = 'CM_AUTH_TRUSTED_HEADER'
export const SESSION_TTL_ENV = 'CM_AUTH_SESSION_TTL'
export const COOKIE_SECURE_ENV = 'CM_AUTH_COOKIE_SECURE'
export const LOGIN_MAX_FAILURES_ENV = 'CM_AUTH_LOGIN_MAX_FAILURES'
export const LOGIN_WINDOW_ENV = 'CM_AUTH_LOGIN_WINDOW'

export const DEFAULT_SESSION_TTL = '30d'
export const DEFAULT_LOGIN_MAX_FAILURES = 10
export const DEFAULT_LOGIN_WINDOW = '1m'
// Browsers cap cookie lifetimes at 400 days and Hono refuses a longer Max-Age.
const MAX_SESSION_TTL_MS = 400 * 86_400_000

export interface PasswordAuthConfig {
  strategy: 'password'
  sessionTtlMs: number
  secureCookie: boolean
  loginRateLimit: { maxFailures: number, windowMs: number }
}

export type AuthConfig =
  | { strategy: 'development' }
  | PasswordAuthConfig
  | { strategy: 'trusted-header', header: string }

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^`|~\w-]+$/

export function resolveAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const strategy = env[AUTH_STRATEGY_ENV] || 'development'
  if (!isAuthStrategyName(strategy)) {
    throw new Error(`${AUTH_STRATEGY_ENV} must be one of ${AUTH_STRATEGY_NAMES.join(', ')}, got "${strategy}"`)
  }
  switch (strategy) {
    case 'development':
      return { strategy }
    case 'password':
      return {
        strategy,
        sessionTtlMs: parseDuration(SESSION_TTL_ENV, env[SESSION_TTL_ENV] || DEFAULT_SESSION_TTL),
        secureCookie: parseBoolean(COOKIE_SECURE_ENV, env[COOKIE_SECURE_ENV], false),
        loginRateLimit: {
          maxFailures: parsePositiveInt(LOGIN_MAX_FAILURES_ENV, env[LOGIN_MAX_FAILURES_ENV], DEFAULT_LOGIN_MAX_FAILURES),
          windowMs: parseDuration(LOGIN_WINDOW_ENV, env[LOGIN_WINDOW_ENV] || DEFAULT_LOGIN_WINDOW),
        },
      }
    case 'trusted-header': {
      const header = env[TRUSTED_HEADER_ENV]?.trim()
      // No default: the name must match the one the fronting proxy overwrites, or clients could set it themselves.
      if (!header) throw new Error(`${TRUSTED_HEADER_ENV} is required when ${AUTH_STRATEGY_ENV}=trusted-header`)
      if (!HEADER_NAME_PATTERN.test(header)) throw new Error(`${TRUSTED_HEADER_ENV} is not a valid header name: "${header}"`)
      return { strategy, header: header.toLowerCase() }
    }
  }
}

const DURATION_UNITS_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const

function parseDuration(name: string, value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim())
  const ms = match ? Number(match[1]) * DURATION_UNITS_MS[match[2] as keyof typeof DURATION_UNITS_MS] : 0
  if (ms <= 0 || ms > MAX_SESSION_TTL_MS) throw new Error(`${name} must be a duration such as 90s, 12h or 30d, at most 400d, got "${value}"`)
  return ms
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false, got "${value}"`)
}

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${value}"`)
  return n
}
