import type { ApiErrorBody, ScopeLabel } from '@candy-mountain/platform-sdk'
import {
  ISSUE_ID_PATTERN,
  MAX_DEPENDENCY_IDS,
  type IssueCommentListResponse,
  type IssueDependencyListResponse,
  type IssueListResponse,
  type IssueResponse,
} from './wire'
import { Hono, type Context } from 'hono'
import { type AppEnv, type Db, getWorkspaceBySlug, WorkspaceError } from '@candy-mountain/platform-daemon'
import { RepositoryError, type RepositoryPaths } from '@candy-mountain/plugin-repository'
import { IssueError } from './errors'
import { issuesService, type IssueProject, type IssuesService } from './service'

export function onIssueError(error: Error, c: Context) {
  if (error instanceof IssueError || error instanceof WorkspaceError || error instanceof RepositoryError) {
    return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
  }
  throw error
}

/** The workspace and its checkout; a workspace without a repository is a not_found RepositoryError. */
export function issueProject(db: Db, repository: RepositoryPaths, slug: string, label?: ScopeLabel): IssueProject {
  const project = getWorkspaceBySlug(db, slug, label)
  return { id: project.id, path: repository.get(project.id) }
}

function issueId(raw: string): string {
  // Ids go to bd as arguments, so anything that could read as a flag is refused.
  if (!ISSUE_ID_PATTERN.test(raw)) throw new IssueError('invalid_request', `Invalid issue id: ${raw}`)
  return raw
}

function dependencyIds(c: Context): string[] {
  const ids = c.req.queries('ids')?.flatMap(value => value.split(',')).map(id => id.trim()).filter(id => id !== '') ?? []
  if (ids.length === 0) throw new IssueError('invalid_request', 'Pass one or more issue ids as ?ids=a,b')
  if (ids.length > MAX_DEPENDENCY_IDS) throw new IssueError('invalid_request', `At most ${MAX_DEPENDENCY_IDS} ids per request`)
  return ids.map(issueId)
}

/** Mounted at WORKSPACES_PATH; every route is scoped to `/:slug/issues`. */
export function issueRoutes(repository: RepositoryPaths, service: IssuesService = issuesService) {
  const app = new Hono<AppEnv>()
  app.onError(onIssueError)

  const project = (c: Context<AppEnv>) => issueProject(c.var.db, repository, c.req.param('slug') ?? '', c.var.scopeLabel)

  app.get('/:slug/issues', async c =>
    c.json<IssueListResponse>({ issues: await service.list(project(c)) }),
  )

  app.get('/:slug/issues/dependencies', async c =>
    c.json<IssueDependencyListResponse>({ dependencies: await service.dependencies(project(c), dependencyIds(c)) }),
  )

  app.get('/:slug/issues/:id', async c =>
    c.json<IssueResponse>({ issue: await service.show(project(c), issueId(c.req.param('id'))) }),
  )

  app.get('/:slug/issues/:id/comments', async c =>
    c.json<IssueCommentListResponse>({ comments: await service.comments(project(c), issueId(c.req.param('id'))) }),
  )

  return app
}
