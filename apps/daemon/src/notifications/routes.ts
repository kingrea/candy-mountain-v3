import type { ApiErrorBody, NotificationRulesResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { NotificationError, parseUpdateNotificationRules, readNotificationRules, updateNotificationRules } from './rules'

export function notificationRoutes() {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof NotificationError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/notifications', requireAdmin(), (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    return c.json<NotificationRulesResponse>({ rules: readNotificationRules(c.var.db, project.id) })
  })

  app.put('/:slug/notifications', requireAdmin(), async (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    const body = await c.req.json().catch(() => {
      throw new NotificationError('invalid_request', 'Request body must be valid JSON')
    })
    return c.json<NotificationRulesResponse>({ rules: updateNotificationRules(c.var.db, project.id, parseUpdateNotificationRules(body)) })
  })

  return app
}
