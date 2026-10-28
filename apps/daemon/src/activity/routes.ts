import type { ActivityListResponse, ApiErrorBody } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { ProjectError } from '../projects'
import { getProjectBySlug } from '../projects/projects'
import { ActivityError } from './errors'
import { listActivityEvents, parseListQuery } from './events'

export function activityRoutes() {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof ActivityError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/activity', (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    return c.json<ActivityListResponse>(listActivityEvents(c.var.db, project.id, parseListQuery(c.req.query())))
  })

  return app
}
