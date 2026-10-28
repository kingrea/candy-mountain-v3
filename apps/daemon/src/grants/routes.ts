import { type ApiErrorBody, type GrantListResponse, type GrantResponse } from '@candy-mountain/shared'
import { asc } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import { roles } from '../db/schema'
import { GrantError } from './errors'
import { listGrants, parseSetGrant, setGrant } from './grants'
import { resolveRoleRungs } from './resolve'

export function grantRoutes() {
  const app = new Hono<AppEnv>()
  app.use(requireAdmin())
  app.onError((error, c) => {
    if (error instanceof GrantError) return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    throw error
  })

  app.get('/', (c) => {
    const roleRows = c.var.db.select({ slug: roles.slug, name: roles.name }).from(roles).orderBy(asc(roles.slug)).all()
    return c.json<GrantListResponse>({
      grants: listGrants(c.var.db),
      roles: roleRows.map(role => ({ role: role.slug, name: role.name, rungs: resolveRoleRungs(c.var, [role.slug]) })),
    })
  })

  app.put('/', async (c) => {
    const body = await c.req.json().catch(() => {
      throw new GrantError('invalid_request', 'Request body must be valid JSON')
    })
    return c.json<GrantResponse>({ grant: setGrant(c.var, parseSetGrant(body)) })
  })

  return app
}
