import { randomUUID } from 'node:crypto'
import type { ApiErrorBody, BotSessionCloseResponse, BotSessionLease, BotSessionStartResponse } from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import { BotError, botProjectId } from '../bots'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { SessionError } from '../sessions'
import { WorktreeError, type WorktreeLease } from '../worktrees'
import { BotStartError } from './errors'
import type { BotSessionService } from './service'

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

async function readOptionalJson(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text()
  if (!raw.trim()) return {}
  let body: unknown
  try {
    body = JSON.parse(raw)
  }
  catch {
    throw new BotError('invalid_request', 'Request body must be valid JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BotError('invalid_request', 'Request body must be an object')
  return body as Record<string, unknown>
}

function parseStart(body: Record<string, unknown>): { threadId: string | undefined } {
  const { threadId, ...rest } = body
  if (Object.keys(rest).length) throw new BotError('invalid_request', `Unknown field(s) ${Object.keys(rest).join(', ')}`)
  if (threadId === undefined || threadId === null) return { threadId: undefined }
  if (typeof threadId !== 'string' || !THREAD_ID_PATTERN.test(threadId)) throw new BotError('invalid_request', 'threadId must be a thread id')
  return { threadId }
}

export const toLeaseResponse = (lease: WorktreeLease): BotSessionLease => ({
  id: lease.id,
  path: lease.path,
  branch: lease.branch,
  baseBranch: lease.baseBranch,
  dependencies: lease.dependencies ? { status: lease.dependencies.status, checkedAt: lease.dependencies.checkedAt } : null,
  unpushedWork: lease.unpushedWork,
  unpushedReason: lease.unpushedReason,
})

/** The console holder: admin only, like the bot itself. Prompt, stream and answer decisions through the session routes. */
export function botSessionRoutes(service: BotSessionService) {
  const app = new Hono<AppEnv>()
  const admin = requireAdmin()
  app.onError((error, c) => {
    if (error instanceof BotStartError) return c.json<ApiErrorBody>({ error: { code: error.reason, message: error.message } }, error.status)
    if (error instanceof BotError || error instanceof ProjectError || error instanceof SessionError || error instanceof WorktreeError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  function botIdOf(c: Context<AppEnv>): string {
    const id = c.req.param('id')!
    if (botProjectId(c.var.db, id) !== getProjectBySlug(c.var.db, c.req.param('slug')!).id) throw new BotError('not_found', `No bot with id "${id}" in this project`)
    return id
  }

  app.post('/:slug/bots/:id/sessions', admin, async (c) => {
    const botId = botIdOf(c)
    const { threadId } = parseStart(await readOptionalJson(c))
    const holder = { kind: 'console' as const, id: threadId ?? randomUUID() }
    if (threadId) {
      const session = service.find(holder)
      if (session && session.posture?.bot?.id !== botId) throw new BotError('not_found', `Thread "${threadId}" belongs to another bot`)
    }
    const started = await service.start({ botId, holder, actorId: c.var.actor.id, signal: c.req.raw.signal })
    const body: BotSessionStartResponse = { session: started.session, lease: toLeaseResponse(started.lease), thread: started.thread, resumed: started.resumed, warnings: started.warnings }
    return c.json(body, started.resumed ? 200 : 201)
  })

  app.post('/:slug/bots/:id/sessions/:sessionId/close', admin, async (c) => {
    const botId = botIdOf(c)
    const sessionId = c.req.param('sessionId')!
    if (service.get(sessionId)?.posture?.bot?.id !== botId) throw new SessionError('not_found', `No session with id "${sessionId}" for this bot`)
    const closed = (await service.closeSession(sessionId))!
    const body: BotSessionCloseResponse = { session: closed.session, lease: closed.lease ? toLeaseResponse(closed.lease) : null, released: closed.released, keptUnpushed: closed.keptUnpushed }
    return c.json(body)
  })

  return app
}
