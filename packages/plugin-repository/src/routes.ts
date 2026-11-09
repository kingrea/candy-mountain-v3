import type { ApiErrorBody } from '@crab-shack/platform-sdk'
import type { RepositoryCheckResponse, RepositoryResponse } from './wire'
import { Hono, type Context } from 'hono'
import { type AppEnv, getWorkspaceBySlug, WorkspaceError } from '@crab-shack/platform-daemon'
import { RepositoryError } from './errors'
import { checkRepositoryPath, getRepository, reverifyRepository, setRepository } from './service'
import { parseCheckRepositoryPath, parseSetRepository } from './validation'

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  }
  catch {
    throw new RepositoryError('invalid_request', 'Request body must be valid JSON')
  }
}

/** Mounted under the workspace prefix: a workspace's repository, and a path check that saves nothing. */
export function repositoryRoutes() {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof RepositoryError || error instanceof WorkspaceError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  const workspaceOf = (c: Context<AppEnv>) => getWorkspaceBySlug(c.var.db, c.req.param('slug')!, c.var.scopeLabel)

  app.post('/repository/check', async (c) => {
    const { path } = parseCheckRepositoryPath(await readJson(c))
    return c.json<RepositoryCheckResponse>({ verification: await checkRepositoryPath(path) })
  })

  app.get('/:slug/repository', c => c.json<RepositoryResponse>({ repository: getRepository(c.var.db, workspaceOf(c).id) }))

  app.put('/:slug/repository', async (c) => {
    const workspace = workspaceOf(c)
    const { source } = parseSetRepository(await readJson(c))
    return c.json<RepositoryResponse>({ repository: await setRepository(c.var.db, workspace.id, source) })
  })

  app.post('/:slug/repository/verify', async c =>
    c.json<RepositoryResponse>({ repository: await reverifyRepository(c.var.db, workspaceOf(c).id) }),
  )

  return app
}
