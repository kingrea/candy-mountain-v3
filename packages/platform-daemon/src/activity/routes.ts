import type { ActivityListResponse, ApiErrorBody } from '@candy-mountain/platform-sdk'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { WorkspaceError } from '../workspaces'
import { getWorkspaceBySlug } from '../workspaces/workspaces'
import { ActivityError } from './errors'
import { listActivityEvents, parseListQuery } from './events'
import { activityEventTypesFor } from './types'

export function activityRoutes() {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof ActivityError || error instanceof WorkspaceError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/activity', (c) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'), c.var.scopeLabel)
    return c.json<ActivityListResponse>(listActivityEvents(c.var.db, workspace.id, parseListQuery(c.req.query(), activityEventTypesFor(c.var.db))))
  })

  return app
}
