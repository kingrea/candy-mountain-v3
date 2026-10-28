import {
  liveVersionSourceInfo,
  type ApiErrorBody, type EnvironmentListResponse, type EnvironmentResponse, type LiveVersionSourceListResponse, type LiveVersionsResponse,
} from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import type { SecretsReader } from '../plugins/instances/instances'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { LIVE_VERSION_SOURCE_REGISTRY } from './builtin-sources'
import { EnvironmentError } from './errors'
import { createEnvironment, deleteEnvironment, getEnvironment, listEnvironments, readLiveVersions, updateEnvironment } from './service'
import type { LiveVersionSourceRegistry } from './sources'
import { parseCreateEnvironment, parseUpdateEnvironment } from './validation'

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  }
  catch {
    throw new EnvironmentError('invalid_request', 'Request body must be valid JSON')
  }
}

export interface EnvironmentRouteOptions {
  sources?: LiveVersionSourceRegistry
  fetch?: typeof fetch
}

/** Writes are admin only; reads are open to any signed-in actor until a deployments capability gates them. */
export function environmentRoutes(secretsReader: SecretsReader, { sources = LIVE_VERSION_SOURCE_REGISTRY, fetch }: EnvironmentRouteOptions = {}) {
  const app = new Hono<AppEnv>()
  const admin = requireAdmin()
  app.onError((error, c) => {
    if (error instanceof EnvironmentError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  const projectOf = (c: Context<AppEnv>) => getProjectBySlug(c.var.db, c.req.param('slug')!)

  app.get('/:slug/environments', c =>
    c.json<EnvironmentListResponse>({ environments: listEnvironments(c.var.db, projectOf(c).id) }),
  )

  app.post('/:slug/environments', admin, async (c) => {
    const projectId = projectOf(c).id
    const environment = createEnvironment(c.var, projectId, parseCreateEnvironment(await readJson(c)), sources)
    return c.json<EnvironmentResponse>({ environment }, 201)
  })

  app.get('/:slug/environments/:id', c =>
    c.json<EnvironmentResponse>({ environment: getEnvironment(c.var.db, projectOf(c).id, c.req.param('id')) }),
  )

  app.patch('/:slug/environments/:id', admin, async (c) => {
    const projectId = projectOf(c).id
    const environment = updateEnvironment(c.var, projectId, c.req.param('id'), parseUpdateEnvironment(await readJson(c)), sources)
    return c.json<EnvironmentResponse>({ environment })
  })

  app.delete('/:slug/environments/:id', admin, (c) => {
    deleteEnvironment(c.var.db, projectOf(c).id, c.req.param('id'))
    return c.body(null, 204)
  })

  app.get('/:slug/live-versions', async (c) => {
    const project = projectOf(c)
    const environments = await readLiveVersions({ ...c.var, secretsReader }, project, { sources, fetch, signal: c.req.raw.signal })
    return c.json<LiveVersionsResponse>({ environments })
  })

  return app
}

export function liveVersionSourceRoutes(sources: LiveVersionSourceRegistry = LIVE_VERSION_SOURCE_REGISTRY) {
  const app = new Hono<AppEnv>()
  app.get('/', c => c.json<LiveVersionSourceListResponse>({ sources: sources.list().map(liveVersionSourceInfo) }))
  return app
}
