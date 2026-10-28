import type { AddAssigneeResponse, ApiErrorBody, ProjectAssigneesResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { ProjectError } from '../projects'
import { getProjectBySlug } from '../projects/projects'
import { requireCapability } from '../registry/gate'
import { AssigneeError } from './errors'
import { addAssignee, listAssignees, parseAddAssignee } from './service'

export function assigneeRoutes() {
  const app = new Hono<AppEnv>()
  const gate = requireCapability({ capability: 'issues', view: 'issues' })
  app.onError((error, c) => {
    if (error instanceof AssigneeError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/assignees', gate, (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    return c.json<ProjectAssigneesResponse>({ assignees: listAssignees(c.var.db, project.id) })
  })

  app.post('/:slug/assignees', gate, async (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    const body = await c.req.json().catch(() => {
      throw new AssigneeError('invalid_request', 'Request body must be valid JSON')
    })
    return c.json<AddAssigneeResponse>({ assignee: addAssignee(c.var.db, project.id, parseAddAssignee(body)) })
  })

  return app
}
