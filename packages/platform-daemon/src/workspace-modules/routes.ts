import type { ApiErrorBody, WorkspaceModulesResponse } from '@candy-mountain/platform-sdk'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import { WorkspaceError } from '../workspaces'
import { getWorkspaceBySlug } from '../workspaces/workspaces'
import { listEnabledModules, parseModuleIds, setEnabledModules } from './enablement'
import { WorkspaceModulesError } from './errors'

export function workspaceModuleRoutes() {
  const app = new Hono<AppEnv>()
  const admin = requireAdmin()
  app.onError((error, c) => {
    if (error instanceof WorkspaceModulesError || error instanceof WorkspaceError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  app.get('/:slug/modules', admin, (c) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'))
    return c.json<WorkspaceModulesResponse>({ modules: listEnabledModules(c.var.db, workspace.id, c.var.modules) })
  })

  app.put('/:slug/modules', admin, async (c) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'))
    const body = await c.req.json().catch(() => {
      throw new WorkspaceModulesError('invalid_request', 'Request body must be valid JSON')
    })
    const modules = parseModuleIds(body, c.var.modules)
    return c.json<WorkspaceModulesResponse>({ modules: setEnabledModules(c.var.db, workspace.id, modules, c.var.modules) })
  })

  return app
}
