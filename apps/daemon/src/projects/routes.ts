import type {
  ApiErrorBody,
  OrganisationListResponse,
  OrganisationResponse,
  Project,
  ProjectListResponse,
  ProjectResponse,
  VerifyPathResponse,
} from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { deleteProjectPluginInstances, type SecretsReader } from '../plugins/instances/instances'
import { ProjectError } from './errors'
import {
  createOrganisation,
  deleteOrganisation,
  getOrganisationBySlug,
  listOrganisations,
  updateOrganisation,
} from './organisations'
import {
  archiveProject,
  createProject,
  deleteProject,
  getProjectBySlug,
  listProjects,
  reverifyProject,
  unarchiveProject,
  updateProject,
} from './projects'
import {
  parseCreateOrganisation,
  parseCreateProject,
  parseUpdateOrganisation,
  parseUpdateProject,
  parseVerifyPath,
} from './validation'
import { normaliseProjectPath, verifyPath } from './verification'

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json()
  }
  catch {
    throw new ProjectError('invalid_request', 'Request body must be valid JSON')
  }
}

function onProjectError(error: Error, c: Context) {
  if (error instanceof ProjectError) {
    return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
  }
  throw error
}

export interface ProjectRouteHooks {
  /** The definitions' deletion hooks, dependents first; a throw leaves the project in place. */
  onWorkspaceDeleted?(project: Project): Promise<void>
}

export function projectRoutes(secretsReader: SecretsReader, hooks: ProjectRouteHooks = {}) {
  const app = new Hono<AppEnv>()
  app.onError(onProjectError)

  app.get('/', (c) => {
    const includeArchived = c.req.query('includeArchived') === 'true'
    return c.json<ProjectListResponse>({ projects: listProjects(c.var.db, { includeArchived }) })
  })

  app.post('/', async (c) => {
    const project = await createProject(c.var.db, parseCreateProject(await readJson(c)))
    return c.json<ProjectResponse>({ project }, 201)
  })

  app.post('/verify-path', async (c) => {
    const { path } = parseVerifyPath(await readJson(c))
    return c.json<VerifyPathResponse>({ verification: await verifyPath(normaliseProjectPath(path)) })
  })

  app.get('/:slug', c => c.json<ProjectResponse>({ project: getProjectBySlug(c.var.db, c.req.param('slug')) }))

  app.patch('/:slug', async (c) => {
    const project = await updateProject(c.var.db, c.req.param('slug'), parseUpdateProject(await readJson(c)))
    return c.json<ProjectResponse>({ project })
  })

  app.post('/:slug/verify', async c =>
    c.json<ProjectResponse>({ project: await reverifyProject(c.var.db, c.req.param('slug')) }),
  )

  app.post('/:slug/archive', c => c.json<ProjectResponse>({ project: archiveProject(c.var.db, c.req.param('slug')) }))

  app.post('/:slug/unarchive', c => c.json<ProjectResponse>({ project: unarchiveProject(c.var.db, c.req.param('slug')) }))

  app.delete('/:slug', async (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    await hooks.onWorkspaceDeleted?.(project)
    await deleteProjectPluginInstances({ ...c.var, secretsReader }, project.id)
    deleteProject(c.var.db, project.slug)
    return c.body(null, 204)
  })

  return app
}

export function organisationRoutes() {
  const app = new Hono<AppEnv>()
  app.onError(onProjectError)

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
