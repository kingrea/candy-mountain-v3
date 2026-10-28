import type { ApiErrorBody, RegistryResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { loadRegistry } from './load'

export function registryRoutes() {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof ProjectError) return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    throw error
  })

  app.get('/:slug/registry', (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    return c.json<RegistryResponse>(loadRegistry(c.var, c.var.actor, project))
  })

  return app
}
