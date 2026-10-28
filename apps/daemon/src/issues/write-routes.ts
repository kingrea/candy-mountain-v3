import type {
  BulkUpdateIssuesResponse,
  CreateIssueResponse,
  IssueCommentResponse,
  IssueResponse,
} from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { getProjectBySlug } from '../projects'
import { requireCapability } from '../registry/gate'
import { IssueError } from './errors'
import { onIssueError } from './routes'
import {
  commentId,
  issueId,
  parseBulkUpdate,
  parseCloseIssue,
  parseComment,
  parseCreateIssue,
  parseUpdateIssue,
} from './write-validation'
import { issueWriter, type IssueWriter } from './writes'

async function readJson(c: Context): Promise<unknown> {
  const raw = await c.req.text()
  if (raw.trim() === '') return undefined
  try {
    return JSON.parse(raw) as unknown
  }
  catch {
    throw new IssueError('invalid_request', 'Request body must be valid JSON')
  }
}

export function issueWriteRoutes(writer: IssueWriter = issueWriter) {
  const app = new Hono<AppEnv>()
  app.onError(onIssueError)

  const project = (c: Context<AppEnv>) => getProjectBySlug(c.var.db, c.req.param('slug') ?? '')
  const actor = (c: Context<AppEnv>) => c.var.actor.username
  const id = (c: Context<AppEnv>) => issueId(c.req.param('id'))
  const write = requireCapability({ capability: 'issues', tool: 'issues.write' })
  const comment = requireCapability({ capability: 'issues', tool: 'issues.comment' })

  app.post('/:slug/issues', write, async (c) => {
    const request = parseCreateIssue(await readJson(c))
    return c.json<CreateIssueResponse>(await writer.create(project(c), request, actor(c)), 201)
  })

  app.post('/:slug/issues/bulk', write, async (c) => {
    const request = parseBulkUpdate(await readJson(c))
    return c.json<BulkUpdateIssuesResponse>(await writer.bulkUpdate(project(c), request, actor(c)))
  })

  app.patch('/:slug/issues/:id', write, async (c) => {
    const request = parseUpdateIssue(await readJson(c))
    return c.json<IssueResponse>({ issue: await writer.update(project(c), id(c), request, actor(c)) })
  })

  app.post('/:slug/issues/:id/close', write, async (c) => {
    const request = parseCloseIssue(await readJson(c))
    return c.json<IssueResponse>({ issue: await writer.close(project(c), id(c), request, actor(c)) })
  })

  app.post('/:slug/issues/:id/comments', comment, async (c) => {
    const { text } = parseComment(await readJson(c))
    return c.json<IssueCommentResponse>({ comment: await writer.addComment(project(c), id(c), text, actor(c)) }, 201)
  })

  app.patch('/:slug/issues/:id/comments/:commentId', comment, async (c) => {
    const { text } = parseComment(await readJson(c))
    const comment = await writer.editComment(project(c), id(c), commentId(c.req.param('commentId')), text, actor(c))
    return c.json<IssueCommentResponse>({ comment })
  })

  return app
}
