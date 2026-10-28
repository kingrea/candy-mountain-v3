import type { ApiErrorBody, ProjectModulesResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import { ProjectError } from '../projects'
import { getProjectBySlug } from '../projects/projects'
import { listEnabledModules, parseModuleIds, setEnabledModules } from './enablement'
import { ProjectModulesError } from './errors'

export function projectModuleRoutes() {
  const app = new Hono<AppEnv>()
  const admin = requireAdmin()
  app.onError((error, c) => {
    if (error instanceof ProjectModulesError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/modules', admin, (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    return c.json<ProjectModulesResponse>({ modules: listEnabledModules(c.var.db, project.id) })
  })

  app.put('/:slug/modules', admin, async (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    const body = await c.req.json().catch(() => {
      throw new ProjectModulesError('invalid_request', 'Request body must be valid JSON')
    })
    const modules = parseModuleIds(body, c.var.modules)
    return c.json<ProjectModulesResponse>({ modules: setEnabledModules(c.var.db, project.id, modules) })
  })

  return app
}
