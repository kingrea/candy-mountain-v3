import type { ApiErrorBody, NotificationDeliveryResponse, NotificationRulesResponse } from '@candy-mountain/platform-sdk'
import { Hono } from 'hono'
import { activityEventTypesFor } from '../activity/types'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import type { NotificationChannel } from '../capabilities/definition'
import type { Db } from '../db'
import { WorkspaceError } from '../workspaces/errors'
import { getWorkspaceBySlug } from '../workspaces/workspaces'
import { describeDelivery } from './dispatcher'
import { NotificationError, parseUpdateNotificationRules, readNotificationRules, updateNotificationRules } from './rules'

const kindsOf = (db: Db) => [...activityEventTypesFor(db).notificationKinds()]

export function notificationRoutes(channels: readonly NotificationChannel[]) {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof NotificationError || error instanceof WorkspaceError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/notifications', requireAdmin(), (c) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'), c.var.scopeLabel)
    return c.json<NotificationRulesResponse>({ kinds: kindsOf(c.var.db), rules: readNotificationRules(c.var.db, workspace.id) })
  })

  app.get('/:slug/notifications/delivery', requireAdmin(), (c) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'), c.var.scopeLabel)
    return c.json<NotificationDeliveryResponse>(describeDelivery(channels, workspace))
  })

  app.put('/:slug/notifications', requireAdmin(), async (c) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'), c.var.scopeLabel)
    const body = await c.req.json().catch(() => {
      throw new NotificationError('invalid_request', 'Request body must be valid JSON')
    })
    const rules = updateNotificationRules(c.var.db, workspace.id, parseUpdateNotificationRules(body, activityEventTypesFor(c.var.db)))
    return c.json<NotificationRulesResponse>({ kinds: kindsOf(c.var.db), rules })
  })

  return app
}
