import type { ApiErrorBody } from '@crab-shack/platform-sdk'
import type { AddAssigneeResponse, ProjectAssigneesResponse } from '../wire'
import { Hono } from 'hono'
import { type AppEnv, getWorkspaceBySlug, requireCapability, WorkspaceError } from '@crab-shack/platform-daemon'
import { AssigneeError } from './errors'
import { addAssignee, listAssignees, parseAddAssignee } from './service'

export function assigneeRoutes() {
  const app = new Hono<AppEnv>()
  const gate = requireCapability({ capability: 'issues', view: 'issues' })
  app.onError((error, c) => {
    if (error instanceof AssigneeError || error instanceof WorkspaceError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/assignees', gate, (c) => {
    const project = getWorkspaceBySlug(c.var.db, c.req.param('slug'), c.var.scopeLabel)
    return c.json<ProjectAssigneesResponse>({ assignees: listAssignees(c.var.db, project.id) })
  })

  app.post('/:slug/assignees', gate, async (c) => {
    const project = getWorkspaceBySlug(c.var.db, c.req.param('slug'), c.var.scopeLabel)
    const body = await c.req.json().catch(() => {
      throw new AssigneeError('invalid_request', 'Request body must be valid JSON')
    })
    return c.json<AddAssigneeResponse>({ assignee: addAssignee(c.var.db, project.id, parseAddAssignee(body)) })
  })

  return app
}
