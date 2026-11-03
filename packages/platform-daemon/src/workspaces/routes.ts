import type {
  ApiErrorBody,
  OrganisationListResponse,
  OrganisationResponse,
  Workspace,
  WorkspaceListResponse,
  WorkspaceResponse,
} from '@candy-mountain/platform-sdk'
import { sql } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import type { Db } from '../db'
import { deleteWorkspacePluginInstances, type PluginInstanceDeleteDeps, type SecretsReader } from '../plugins/instances/instances'
import { WorkspaceError } from './errors'
import {
  createOrganisation,
  deleteOrganisation,
  getOrganisationBySlug,
  listOrganisations,
  updateOrganisation,
} from './organisations'
import {
  archiveWorkspace,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceBySlug,
  listWorkspaces,
  unarchiveWorkspace,
  updateWorkspace,
} from './workspaces'
import {
  parseCreateOrganisation,
  parseCreateWorkspace,
  parseUpdateOrganisation,
  parseUpdateWorkspace,
} from './validation'

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  }
  catch {
    throw new WorkspaceError('invalid_request', 'Request body must be valid JSON')
  }
}

function onWorkspaceError(error: Error, c: Context) {
  if (error instanceof WorkspaceError) {
    return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
  }
  throw error
}

export interface WorkspaceRouteHooks {
  /** The definitions' deletion hooks, dependents first; a throw leaves the workspace and every row in place. */
  onWorkspaceDeleted?(workspace: Workspace): Promise<void>
}

const deletions = new WeakMap<Db, Promise<void>>()

/**
 * One transaction across the hooks and the platform's deletes, so a throw anywhere rolls every row back.
 * Writes other requests make while a hook awaits I/O land in it too; deletions queue because transactions cannot nest.
 */
function removeWorkspace(deps: PluginInstanceDeleteDeps, workspace: Workspace, hooks: WorkspaceRouteHooks): Promise<void> {
  const { db } = deps
  const run = (deletions.get(db) ?? Promise.resolve()).catch(() => {}).then(async () => {
    db.run(sql`BEGIN IMMEDIATE`)
    try {
      await hooks.onWorkspaceDeleted?.(workspace)
      await deleteWorkspacePluginInstances(deps, workspace.id)
      deleteWorkspace(db, workspace.slug)
      db.run(sql`COMMIT`)
    }
    catch (error) {
      db.run(sql`ROLLBACK`)
      throw error
    }
  })
  deletions.set(db, run)
  return run
}

export function workspaceRoutes(secretsReader: SecretsReader, hooks: WorkspaceRouteHooks = {}) {
  const app = new Hono<AppEnv>()
  app.onError(onWorkspaceError)

  app.get('/', (c) => {
    const includeArchived = c.req.query('includeArchived') === 'true'
    return c.json<WorkspaceListResponse>({ workspaces: listWorkspaces(c.var.db, { includeArchived }) })
  })

  app.post('/', async (c) => {
    const workspace = createWorkspace(c.var.db, parseCreateWorkspace(await readJson(c)))
    return c.json<WorkspaceResponse>({ workspace }, 201)
  })

  app.get('/:slug', c => c.json<WorkspaceResponse>({ workspace: getWorkspaceBySlug(c.var.db, c.req.param('slug')) }))

  app.patch('/:slug', async (c) => {
    const workspace = updateWorkspace(c.var.db, c.req.param('slug'), parseUpdateWorkspace(await readJson(c)))
    return c.json<WorkspaceResponse>({ workspace })
  })

  app.post('/:slug/archive', c => c.json<WorkspaceResponse>({ workspace: archiveWorkspace(c.var.db, c.req.param('slug')) }))

  app.post('/:slug/unarchive', c => c.json<WorkspaceResponse>({ workspace: unarchiveWorkspace(c.var.db, c.req.param('slug')) }))

  app.delete('/:slug', async (c) => {
    const workspace = getWorkspaceBySlug(c.var.db, c.req.param('slug'))
    await removeWorkspace({ ...c.var, secretsReader }, workspace, hooks)
    return c.body(null, 204)
  })

  return app
}

export function organisationRoutes() {
  const app = new Hono<AppEnv>()
  app.onError(onWorkspaceError)

  app.get('/', c => c.json<OrganisationListResponse>({ organisations: listOrganisations(c.var.db) }))

  app.post('/', async (c) => {
    const organisation = createOrganisation(c.var.db, parseCreateOrganisation(await readJson(c)))
    return c.json<OrganisationResponse>({ organisation }, 201)
  })

  app.get('/:slug', c =>
    c.json<OrganisationResponse>({ organisation: getOrganisationBySlug(c.var.db, c.req.param('slug')) }),
  )

  app.patch('/:slug', async (c) => {
    const organisation = updateOrganisation(c.var.db, c.req.param('slug'), parseUpdateOrganisation(await readJson(c)))
    return c.json<OrganisationResponse>({ organisation })
  })

  app.delete('/:slug', (c) => {
    deleteOrganisation(c.var.db, c.req.param('slug'))
    return c.body(null, 204)
  })

  return app
}
