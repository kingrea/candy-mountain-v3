import { AUTH_STRATEGY_PATH, HEALTH_PATH, UNAUTHENTICATED_ERROR_CODE, type ApiErrorBody } from '@candy-mountain/shared'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'
import type { AuthStrategy } from './strategy'

// The login page needs the strategy before anyone is signed in.
export const PUBLIC_PATHS: readonly string[] = [HEALTH_PATH, AUTH_STRATEGY_PATH]

export function authMiddleware(strategy: AuthStrategy): MiddlewareHandler<AppEnv> {
  const publicPaths = new Set([...PUBLIC_PATHS, ...(strategy.publicPaths ?? [])])
  return async (c, next) => {
    if (publicPaths.has(c.req.path)) return next()
    const actor = await strategy.resolve(c)
    if (!actor) {
      return c.json<ApiErrorBody>({ error: { code: UNAUTHENTICATED_ERROR_CODE, message: 'Authentication required' } }, 401)
    }
    c.set('actor', actor)
    await next()
  }
}
