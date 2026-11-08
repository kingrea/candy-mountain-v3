import type { ApiErrorBody } from '@candy-mountain/platform-sdk'
import type { BotSlackConnectionResponse } from '../wire'
import { Hono } from 'hono'
import { type AppEnv, getWorkspaceBySlug, requireAdmin, WorkspaceError } from '@candy-mountain/platform-daemon'
import { botProjectId } from '../bots/bots'
import { BotError } from '../bots/errors'
import type { SlackConnections } from '@candy-mountain/plugin-slack'

/** Admin only, like the bot routes it sits beside. */
export function slackRoutes(connections: Pick<SlackConnections, 'status'>) {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof BotError || error instanceof WorkspaceError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/bots/:id/slack', requireAdmin(), (c) => {
    const project = getWorkspaceBySlug(c.var.db, c.req.param('slug'))
    const id = c.req.param('id')
    if (botProjectId(c.var.db, id) !== project.id) throw new BotError('not_found', `No bot with id "${id}" in this project`)
    return c.json<BotSlackConnectionResponse>({ connection: connections.status(id) })
  })

  return app
}
