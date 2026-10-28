import type { Actor, AuthStrategyName } from '@candy-mountain/shared'
import type { Context, Hono } from 'hono'
import type { AppEnv } from '../app'
import type { AuthConfig } from './config'
import { developmentStrategy } from './development'
import { passwordStrategy } from './password'
import { trustedHeaderStrategy } from './trusted-header'

export interface AuthStrategy {
  readonly name: AuthStrategyName
  readonly publicPaths?: readonly string[]
  /** Returns null when the request carries no valid identity, which the middleware turns into a 401. */
  resolve(c: Context<AppEnv>): Actor | null | Promise<Actor | null>
  /** Strategy-specific endpoints mounted under the auth path, such as login. */
  routes?(): Hono<AppEnv>
}

export function createAuthStrategy(config: AuthConfig): AuthStrategy {
  switch (config.strategy) {
    case 'development':
      return developmentStrategy()
    case 'password':
      return passwordStrategy({ sessionTtlMs: config.sessionTtlMs, secureCookie: config.secureCookie, loginRateLimit: config.loginRateLimit })
    case 'trusted-header':
      return trustedHeaderStrategy(config.header)
  }
}
