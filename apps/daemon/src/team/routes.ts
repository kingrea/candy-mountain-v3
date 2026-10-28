import type { ApiErrorBody, TeamMemberListResponse, TeamMemberResponse } from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { TeamError } from './errors'
import { addTeamMember, getTeamMember, listTeamMembers, removeTeamMember, updateTeamMember } from './service'
import { parseCreateTeamMember, parseUpdateTeamMember } from './validation'

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  }
  catch {
    throw new TeamError('invalid_request', 'Request body must be valid JSON')
  }
}

/** Admin only: the roster decides who may drive a project's bots. */
export function teamRoutes() {
  const app = new Hono<AppEnv>()
  const admin = requireAdmin()
  app.onError((error, c) => {
    if (error instanceof TeamError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  const projectIdOf = (c: Context<AppEnv>) => getProjectBySlug(c.var.db, c.req.param('slug')!).id

  app.get('/:slug/team', admin, c =>
    c.json<TeamMemberListResponse>({ members: listTeamMembers(c.var.db, projectIdOf(c)) }),
  )

  app.post('/:slug/team', admin, async (c) => {
    const projectId = projectIdOf(c)
    const member = addTeamMember(c.var.db, projectId, parseCreateTeamMember(await readJson(c)))
    return c.json<TeamMemberResponse>({ member }, 201)
  })

  app.get('/:slug/team/:id', admin, c =>
    c.json<TeamMemberResponse>({ member: getTeamMember(c.var.db, projectIdOf(c), c.req.param('id')) }),
  )

  app.patch('/:slug/team/:id', admin, async (c) => {
    const projectId = projectIdOf(c)
    const member = updateTeamMember(c.var.db, projectId, c.req.param('id'), parseUpdateTeamMember(await readJson(c)))
    return c.json<TeamMemberResponse>({ member })
  })

  app.delete('/:slug/team/:id', admin, (c) => {
    removeTeamMember(c.var.db, projectIdOf(c), c.req.param('id'))
    return c.body(null, 204)
  })

  return app
}
