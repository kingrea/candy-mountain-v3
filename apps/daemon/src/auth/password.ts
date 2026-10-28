import {
  INVALID_CREDENTIALS_ERROR_CODE,
  LOGIN_PATH,
  LOGOUT_PATH,
  RATE_LIMITED_ERROR_CODE,
  SESSION_COOKIE_NAME,
  type ApiErrorBody,
  type LoginRequest,
  type LoginResponse,
} from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { CookieOptions } from 'hono/utils/cookie'
import type { AppEnv } from '../app'
import { users } from '../db/schema'
import { findActorById } from './actors'
import { MAX_PASSWORD_LENGTH, getPasswordHash, verifyAgainstDummy, verifyPassword, type ScryptParams } from './passwords'
import { createSession, deleteExpiredSessions, deleteSession, resolveSession, systemClock, type SessionClock } from './sessions'
import { LoginRateLimiter, ipKey, userKey, type LoginRateLimitOptions } from './rate-limit'
import type { AuthStrategy } from './strategy'

export interface PasswordStrategyOptions {
  sessionTtlMs: number
  secureCookie: boolean
  loginRateLimit?: Pick<LoginRateLimitOptions, 'maxFailures' | 'windowMs'>
  clock?: SessionClock
  /** Cost for the unknown-user dummy hash; stored hashes carry their own. */
  hashing?: ScryptParams
}

export const DEFAULT_LOGIN_RATE_LIMIT = { maxFailures: 10, windowMs: 60_000 }

export function passwordStrategy({
  sessionTtlMs,
  secureCookie,
  loginRateLimit = DEFAULT_LOGIN_RATE_LIMIT,
  clock = systemClock,
  hashing,
}: PasswordStrategyOptions): AuthStrategy {
  const limiter = new LoginRateLimiter({ ...loginRateLimit, clock })
  const cookieOptions: CookieOptions = { path: '/', httpOnly: true, sameSite: 'Lax', secure: secureCookie }

  function loginRoutes() {
    const routes = new Hono<AppEnv>()

    routes.post('/login', async (c) => {
      const credentials = parseLoginRequest(await c.req.json().catch(() => null))
      if (!credentials) {
        return c.json<ApiErrorBody>({ error: { code: 'invalid_request', message: 'Expected { username, password }' } }, 400)
      }
      const keys = [userKey(credentials.username), ipKey(clientIp(c))]
      const retryAfter = limiter.retryAfterSeconds(keys)
      if (retryAfter > 0) {
        c.header('Retry-After', String(retryAfter))
        return c.json<ApiErrorBody>({ error: { code: RATE_LIMITED_ERROR_CODE, message: 'Too many failed logins, try again later' } }, 429)
      }
      const userId = await checkCredentials(c, credentials, hashing)
      const actor = userId ? findActorById(c.var.db, userId) : null
      if (!actor) {
        limiter.recordFailure(keys)
        return c.json<ApiErrorBody>({ error: { code: INVALID_CREDENTIALS_ERROR_CODE, message: 'Invalid username or password' } }, 401)
      }
      limiter.clear(keys[0]!)
      const previous = getCookie(c, SESSION_COOKIE_NAME)
      if (previous) deleteSession(c.var.db, previous)
      deleteExpiredSessions(c.var.db, clock)
      const { token } = createSession(c.var.db, actor.id, sessionTtlMs, clock)
      setCookie(c, SESSION_COOKIE_NAME, token, { ...cookieOptions, maxAge: Math.floor(sessionTtlMs / 1000) })
      return c.json<LoginResponse>({ actor })
    })

    routes.post('/logout', (c) => {
      const token = getCookie(c, SESSION_COOKIE_NAME)
      if (token) deleteSession(c.var.db, token)
      deleteCookie(c, SESSION_COOKIE_NAME, cookieOptions)
      return c.body(null, 204)
    })

    return routes
  }

  return {
    name: 'password',
    // Logout is public so a client holding an expired cookie can still clear it.
    publicPaths: [LOGIN_PATH, LOGOUT_PATH],
    resolve: (c) => {
      const token = getCookie(c, SESSION_COOKIE_NAME)
      const userId = token ? resolveSession(c.var.db, token, clock) : null
      return userId ? findActorById(c.var.db, userId) : null
    },
    routes: loginRoutes,
  }
}

function parseLoginRequest(body: unknown): LoginRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const { username, password } = body as Record<string, unknown>
  if (typeof username !== 'string' || typeof password !== 'string') return null
  if (!username.trim() || !password || password.length > MAX_PASSWORD_LENGTH) return null
  return { username: username.trim(), password }
}

async function checkCredentials(c: Context<AppEnv>, { username, password }: LoginRequest, hashing?: ScryptParams): Promise<string | null> {
  const user = c.var.db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()
  const hash = user ? getPasswordHash(c.var.db, user.id) : null
  const valid = hash ? await verifyPassword(password, hash) : await verifyAgainstDummy(password, hashing)
  return valid ? user!.id : null
}

// Socket address only: X-Forwarded-For is client-controlled unless a proxy overwrites it, and this strategy has no proxy config.
function clientIp(c: Context<AppEnv>): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return env?.incoming?.socket?.remoteAddress ?? 'unknown'
}
