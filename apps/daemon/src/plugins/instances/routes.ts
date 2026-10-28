import {
  pluginTypeInfo,
  type ApiErrorBody,
  type PluginInstanceListResponse,
  type PluginInstanceResponse,
  type PluginTypeListResponse,
} from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../../app'
import { requireAdmin } from '../../auth/admin'
import { findProjectBySlug } from '../../projects/projects'
import { SecretsLockedError } from '../../secrets'
import { PluginActionError } from '../actions'
import { createPluginSecrets } from '../secrets'
import { PluginInstanceError } from './errors'
import {
  createPluginInstance,
  deletePluginInstance,
  getPluginInstance,
  instanceConfig,
  listPluginInstances,
  pluginTypeOf,
  refreshPluginInstanceHealth,
  resetPluginInstanceHealth,
  testPluginInstance,
  updatePluginInstance,
  type SecretsReader,
} from './instances'
import { parseCreatePluginInstance, parseUpdatePluginInstance } from './validation'

function projectIdOf(c: Context<AppEnv>, slug: string): string {
  const project = findProjectBySlug(c.var.db, slug)
  if (!project) throw new PluginInstanceError('project_not_found', `No project with slug "${slug}"`)
  return project.id
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  }
  catch {
    throw new PluginInstanceError('invalid_request', 'Request body must be valid JSON')
  }
}

function onError(error: Error, c: Context) {
  if (error instanceof PluginInstanceError || error instanceof PluginActionError) {
    const headers = error instanceof PluginActionError ? error.headers : {}
    return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status, headers)
  }
  if (error instanceof SecretsLockedError) return c.json<ApiErrorBody>({ error: { code: 'secrets_locked', message: error.message } }, 409)
  throw error
}

/** Type descriptions hold no secrets, so any signed-in actor may read them. */
export function pluginTypeRoutes() {
  const app = new Hono<AppEnv>()
  app.get('/', c => c.json<PluginTypeListResponse>({ types: c.var.pluginTypes.list().map(pluginTypeInfo) }))
  return app
}

/** Takes the plaintext reader as a parameter because it must never sit in `c.var`. */
export function pluginInstanceRoutes(secretsReader: SecretsReader) {
  const app = new Hono<AppEnv>()
  app.use(requireAdmin())
  app.onError(onError)

  app.get('/', (c) => {
    const slug = c.req.query('project')
    return c.json<PluginInstanceListResponse>({ instances: listPluginInstances(c.var, { projectId: slug ? projectIdOf(c, slug) : undefined }) })
  })

  app.post('/', async (c) => {
    const { project, ...request } = parseCreatePluginInstance(await readJson(c))
    const instance = createPluginInstance(c.var, { ...request, projectId: project ? projectIdOf(c, project) : null })
    return c.json<PluginInstanceResponse>({ instance }, 201)
  })

  app.get('/:id', c => c.json<PluginInstanceResponse>({ instance: getPluginInstance(c.var, c.req.param('id')) }))

  app.patch('/:id', async (c) => {
    const instance = updatePluginInstance(c.var, c.req.param('id'), parseUpdatePluginInstance(await readJson(c)))
    return c.json<PluginInstanceResponse>({ instance })
  })

  app.delete('/:id', async (c) => {
    await deletePluginInstance({ ...c.var, secretsReader }, c.req.param('id'))
    return c.body(null, 204)
  })

  app.post('/:id/test', async c =>
    c.json<PluginInstanceResponse>({ instance: await testPluginInstance({ ...c.var, secretsReader }, c.req.param('id')) }),
  )

  app.on(['GET', 'POST'], '/:id/:action', async (c) => {
    const instance = getPluginInstance(c.var, c.req.param('id'))
    const type = pluginTypeOf(c.var, instance.type)
    const name = c.req.param('action')
    const action = Object.hasOwn(type.actions ?? {}, name) ? type.actions![name] : undefined
    if (!action || action.method !== c.req.method) {
      throw new PluginInstanceError('action_not_found', `${type.name} instances have no ${c.req.method} action "${name}"`)
    }
    const deps = { ...c.var, secretsReader }
    const result = await action.run({
      instance,
      config: instanceConfig(type, instance),
      secrets: createPluginSecrets(secretsReader, instance.id, type),
      secretsWriter: {
        set: (name, value) => void updatePluginInstance(c.var, instance.id, { secrets: { [name]: value } }),
        clear: name => void updatePluginInstance(c.var, instance.id, { secrets: { [name]: null } }),
      },
      request: c.req.raw,
      signal: c.req.raw.signal,
      paths: c.var.paths,
      refreshHealth: () => refreshPluginInstanceHealth(deps, instance.id),
      resetHealth: () => resetPluginInstanceHealth(deps, instance.id),
    })
    return result instanceof Response ? result : c.json(result ?? null)
  })

  return app
}
