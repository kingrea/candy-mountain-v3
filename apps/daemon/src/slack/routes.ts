import type { ApiErrorBody, BotSlackConnectionResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import { botProjectId } from '../bots/bots'
import { BotError } from '../bots/errors'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import type { SlackConnections } from './manager'

/** Admin only, like the bot routes it sits beside. */
export function slackRoutes(connections: Pick<SlackConnections, 'status'>) {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof BotError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/bots/:id/slack', requireAdmin(), (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    const id = c.req.param('id')
    if (botProjectId(c.var.db, id) !== project.id) throw new BotError('not_found', `No bot with id "${id}" in this project`)
    return c.json<BotSlackConnectionResponse>({ connection: connections.status(id) })
  })

  return app
}
