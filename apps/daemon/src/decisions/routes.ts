import { DECISION_OPTION_KINDS, type AnswerDecisionRequest, type ApiErrorBody, type DecisionListResponse, type DecisionResponse } from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../app'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { requireSessionAccess, SessionError, type SessionManager } from '../sessions'
import { DecisionError } from './errors'
import { isRecord } from './model'
import type { DecisionService } from './service'

const ANSWER_FIELDS = new Set(['optionKind', 'optionId', 'answer', 'explanation'])

export function parseAnswer(body: unknown): AnswerDecisionRequest {
  if (!isRecord(body)) throw new DecisionError('invalid_request', 'Request body must be a JSON object')
  const unknown = Object.keys(body).find(key => !ANSWER_FIELDS.has(key))
  if (unknown) throw new DecisionError('invalid_request', `Unexpected field "${unknown}"`)
  if (!(DECISION_OPTION_KINDS as readonly unknown[]).includes(body.optionKind)) throw new DecisionError('invalid_request', `optionKind must be one of ${DECISION_OPTION_KINDS.join(', ')}`)
  if (body.optionId !== undefined && typeof body.optionId !== 'string') throw new DecisionError('invalid_request', 'optionId must be a string')
  if (body.answer !== undefined && !isRecord(body.answer)) throw new DecisionError('invalid_request', 'answer must be an object')
  if (body.explanation !== undefined && typeof body.explanation !== 'string') throw new DecisionError('invalid_request', 'explanation must be a string')
  return body as unknown as AnswerDecisionRequest
}

export function decisionRoutes(sessions: SessionManager, decisions: DecisionService) {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof DecisionError || error instanceof SessionError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  function sessionIdOf(c: Context<AppEnv>): string {
    const id = c.req.param('id')!
    const session = sessions.get(id)
    if (!session || session.projectId !== getProjectBySlug(c.var.db, c.req.param('slug')!).id) throw new SessionError('not_found', `No session with id "${id}" in this project`)
    return id
  }

  const access = requireSessionAccess(sessions)

  app.get('/:slug/sessions/:id/decisions', access, c => c.json<DecisionListResponse>({ decisions: decisions.list(sessionIdOf(c)) }))

  app.post('/:slug/sessions/:id/decisions/:decisionId', access, async (c) => {
    const sessionId = sessionIdOf(c)
    const decisionId = c.req.param('decisionId')
    let body: unknown
    try {
      body = await c.req.json()
    }
    catch {
      throw new DecisionError('invalid_request', 'Request body must be valid JSON')
    }
    const request = parseAnswer(body)
    if (decisions.get(decisionId)?.sessionId !== sessionId) throw new DecisionError('not_found', `No decision with id "${decisionId}" in this session`)
    return c.json<DecisionResponse>({ decision: decisions.answer(decisionId, { ...request, surface: 'web', actorId: c.var.actor.id }) })
  })

  return app
}
