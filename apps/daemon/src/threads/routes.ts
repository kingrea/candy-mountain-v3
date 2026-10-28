import type { ApiErrorBody, ChatAgentOptionsResponse, ChatThread, ChatThreadCloseResponse, ChatThreadListResponse, ChatThreadPromptResponse, ChatThreadResponse, CreateChatThreadRequest, Project, UpdateChatThreadRequest } from '@candy-mountain/shared'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app'
import { BotStartError } from '../bot-sessions/errors'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug } from '../projects/projects'
import { checkChat, resolveCapabilityAccess, type GateRefusal, type GateResult } from '../registry'
import { SessionError } from '../sessions'
import { familyCapability } from '../sessions/access'
import { parsePrompt } from '../sessions/routes'
import { ThreadError } from './errors'
import { chatAgents, findThreadAgent, projectBotAgents, type ChatAgent, type ThreadService } from './service'

const TITLE_MAX_LENGTH = 200

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  }
  catch {
    throw new ThreadError('invalid_request', 'Request body must be valid JSON')
  }
  if (!isRecord(body)) throw new ThreadError('invalid_request', 'Request body must be a JSON object')
  return body
}

function optionalChoice(body: Record<string, unknown>, name: 'model' | 'effort'): string | null | undefined {
  const value = body[name]
  if (value === undefined || value === null) return value
  if (typeof value !== 'string' || value.trim() === '') throw new ThreadError('invalid_request', `${name} must be a non-empty string or null`)
  return value.trim()
}

function optionalTitle(body: Record<string, unknown>): string | undefined {
  if (body.title === undefined) return undefined
  if (typeof body.title !== 'string' || body.title.trim() === '') throw new ThreadError('invalid_request', 'title must be a non-empty string')
  if (body.title.length > TITLE_MAX_LENGTH) throw new ThreadError('invalid_request', `title must be at most ${TITLE_MAX_LENGTH} characters`)
  return body.title.trim()
}

function optionalIssueIds(body: Record<string, unknown>): string[] | undefined {
  const value = body.issueIds
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || !value.every(id => typeof id === 'string' && id.trim() !== '')) throw new ThreadError('invalid_request', 'issueIds must be a non-empty array of non-empty strings')
  return value.map(id => id.trim())
}

export function parseCreateThread(body: Record<string, unknown>): CreateChatThreadRequest {
  if (typeof body.agentId !== 'string' || body.agentId === '') throw new ThreadError('invalid_request', 'agentId must be a non-empty string')
  const title = optionalTitle(body)
  const model = optionalChoice(body, 'model')
  const effort = optionalChoice(body, 'effort')
  const issueIds = optionalIssueIds(body)
  return { agentId: body.agentId, ...(title === undefined ? {} : { title }), ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }), ...(issueIds === undefined ? {} : { issueIds }) }
}

export function parseUpdateThread(body: Record<string, unknown>): UpdateChatThreadRequest {
  const title = optionalTitle(body)
  const model = optionalChoice(body, 'model')
  const effort = optionalChoice(body, 'effort')
  return { ...(title === undefined ? {} : { title }), ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) }
}

const refusal = (c: Context<AppEnv>, result: GateRefusal) => c.json<ApiErrorBody>({ error: { code: result.code, message: result.reason } }, result.status)

/** Every route but the list is gated on the chat rung of the capability that owns the agent it touches. */
export function threadRoutes(service: ThreadService) {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof BotStartError) return c.json<ApiErrorBody>({ error: { code: error.reason, message: error.message } }, error.status)
    if (error instanceof ThreadError || error instanceof SessionError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  const projectOf = (c: Context<AppEnv>) => getProjectBySlug(c.var.db, c.req.param('slug')!)

  /** Another actor's thread is reported missing rather than forbidden. */
  function threadOf(c: Context<AppEnv>): ChatThread {
    const id = c.req.param('id')!
    const thread = service.get(id)
    if (!thread || thread.projectId !== projectOf(c).id || thread.actorId !== c.var.actor.id) throw new ThreadError('not_found', `No thread with id "${id}" in this project`)
    return thread
  }

  const agentNamed = (c: Context<AppEnv>, agentId: string): ChatAgent => findThreadAgent(c.var.db, c.var.capabilities, projectOf(c).id, agentId)

  /** A bot session also streams and asks through the session routes, which gate on its family's chat capability. */
  function checkAgent(c: Context<AppEnv>, project: Project, agent: ChatAgent): GateResult {
    const capabilityIds = agent.botId === undefined ? [agent.capabilityId] : [agent.capabilityId, familyCapability(c.var.capabilities, agent.family) ?? '']
    const results = capabilityIds.map(capabilityId => checkChat(resolveCapabilityAccess(c.var, c.var.actor, project, capabilityId)))
    return results.find(result => !result.allowed) ?? results[0]!
  }

  const gateAgent = (agentOf: (c: Context<AppEnv>) => string | Promise<string>): MiddlewareHandler<AppEnv> => async (c, next) => {
    const agent = agentNamed(c, await agentOf(c))
    const result = checkAgent(c, projectOf(c), agent)
    if (!result.allowed) return refusal(c, result)
    await next()
  }
  const gateThread = gateAgent(c => threadOf(c).agentId)
  const agentOfThread = (c: Context<AppEnv>): ChatAgent => agentNamed(c, threadOf(c).agentId)

  app.get('/:slug/threads', async (c) => {
    const project = projectOf(c)
    const filter = c.req.query('agent')
    if (filter !== undefined) {
      const agent = agentNamed(c, filter)
      const result = checkAgent(c, project, agent)
      if (!result.allowed) return refusal(c, result)
      return c.json<ChatThreadListResponse>({ threads: service.list(project.id, c.var.actor.id, [agent.id]) })
    }
    const allowed: string[] = []
    let firstRefusal: GateRefusal | undefined
    for (const agent of [...chatAgents(c.var.capabilities), ...projectBotAgents(c.var.db, project.id)]) {
      const result = checkAgent(c, project, agent)
      if (result.allowed) allowed.push(agent.id)
      else firstRefusal ??= result
    }
    if (!allowed.length && firstRefusal) return refusal(c, firstRefusal)
    return c.json<ChatThreadListResponse>({ threads: service.list(project.id, c.var.actor.id, allowed) })
  })

  app.post('/:slug/threads', gateAgent(async c => parseCreateThread(await readJson(c)).agentId), async (c) => {
    const input = parseCreateThread(await readJson(c))
    const response = await service.create({ project: projectOf(c), actorId: c.var.actor.id, agent: agentNamed(c, input.agentId), title: input.title, model: input.model, effort: input.effort, issueIds: input.issueIds, signal: c.req.raw.signal })
    return c.json<ChatThreadResponse>(response, 201)
  })

  app.get('/:slug/threads/agents/:agentId/options', gateAgent(c => c.req.param('agentId')!), (c) => {
    const agent = agentNamed(c, c.req.param('agentId')!)
    const choices = agent.botId === undefined ? service.options(projectOf(c), agent) : { models: [], efforts: [] }
    return c.json<ChatAgentOptionsResponse>({ options: { agentId: agent.id, family: agent.family, ...choices } })
  })

  app.get('/:slug/threads/:id', gateThread, c => c.json<ChatThreadResponse>(service.detail(threadOf(c))))

  app.patch('/:slug/threads/:id', gateThread, async (c) => {
    const input = parseUpdateThread(await readJson(c))
    return c.json<ChatThreadResponse>(service.update(projectOf(c), threadOf(c), agentOfThread(c), input))
  })

  app.post('/:slug/threads/:id/read', gateThread, c => c.json<{ thread: ChatThread }>({ thread: service.markRead(threadOf(c)) }))

  app.post('/:slug/threads/:id/prompt', gateThread, async (c) => {
    const thread = threadOf(c)
    const { text } = parsePrompt(await readJson(c))
    return c.json<ChatThreadPromptResponse>(await service.prompt(thread, text, c.var.actor), 202)
  })

  app.post('/:slug/threads/:id/cancel', gateThread, async c => c.json<ChatThreadPromptResponse>(await service.cancel(threadOf(c))))

  app.post('/:slug/threads/:id/close', gateThread, async c => c.json<ChatThreadCloseResponse>(await service.close(threadOf(c))))

  return app
}
