import { FORBIDDEN_ERROR_CODE, isAdmin, type ApiErrorBody } from '@candy-mountain/shared'
import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'

/** Mount after the auth middleware on any route only the admin may use. */
export function requireAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const actor = c.get('actor')
    if (!actor || !isAdmin(actor)) {
      return c.json<ApiErrorBody>({ error: { code: FORBIDDEN_ERROR_CODE, message: 'Only the admin may do this' } }, 403)
    }
    await next()
  }
}
