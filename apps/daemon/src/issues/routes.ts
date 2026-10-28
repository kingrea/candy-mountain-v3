import {
  ISSUE_ID_PATTERN,
  MAX_DEPENDENCY_IDS,
  type ApiErrorBody,
  type IssueCommentListResponse,
  type IssueDependencyListResponse,
  type IssueListResponse,
  type IssueResponse,
} from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { getProjectBySlug, ProjectError } from '../projects'
import { IssueError } from './errors'
import { issuesService, type IssuesService } from './service'

export function onIssueError(error: Error, c: Context) {
  if (error instanceof IssueError || error instanceof ProjectError) {
    return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
  }
  throw error
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

/** Mounted at PROJECTS_PATH; every route is scoped to `/:slug/issues`. */
export function issueRoutes(service: IssuesService = issuesService) {
  const app = new Hono<AppEnv>()
  app.onError(onIssueError)

  const project = (c: Context<AppEnv>) => getProjectBySlug(c.var.db, c.req.param('slug') ?? '')

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
