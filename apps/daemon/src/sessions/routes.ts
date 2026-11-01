import { CODEX_SESSION_MODES, SESSION_EVENT_NAME, SESSION_PROMPT_MAX_LENGTH, SESSION_STATUS_EVENT_NAME, type AgentSession, type AgentSessionFamily, type AgentSessionPosture, type ApiErrorBody, type CreateSessionRequest, type SessionListResponse, type SessionPromptRequest, type SessionResponse, type SessionStatusEvent } from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AppEnv } from '../app'
import { ProjectError } from '../projects/errors'
import { getProjectBySlug, sourcePath } from '../projects/projects'
import type { GateRefusal } from '../registry'
import { canAccessSession, gateSessionFamily, requireSessionAccess } from './access'
import { SessionError } from './errors'
import type { SessionFamilyRegistry } from '../threads/families'
import type { SessionManager, SessionMessage } from './manager'

// Node fetch (the web proxy) drops a response body that stays silent for 300s.
export const SESSION_EVENTS_HEARTBEAT_MS = 30_000

export interface SessionRoutesOptions {
  heartbeatMs?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  }
  catch {
    throw new SessionError('invalid_request', 'Request body must be valid JSON')
  }
  if (!isRecord(body)) throw new SessionError('invalid_request', 'Request body must be a JSON object')
  return body
}

function parsePosture(value: unknown): AgentSessionPosture | undefined {
  if (value === undefined || value === null) return undefined
  if (!isRecord(value)) throw new SessionError('invalid_request', 'posture must be an object')
  const posture: AgentSessionPosture = {}
  if (value.flags !== undefined) {
    if (!Array.isArray(value.flags) || !value.flags.every(flag => typeof flag === 'string')) throw new SessionError('invalid_request', 'posture.flags must be an array of strings')
    posture.flags = value.flags
  }
  if (value.codex !== undefined) {
    if (!isRecord(value.codex)) throw new SessionError('invalid_request', 'posture.codex must be an object')
    const codex: NonNullable<AgentSessionPosture['codex']> = {}
    if (value.codex.mode !== undefined) {
      if (!(CODEX_SESSION_MODES as readonly unknown[]).includes(value.codex.mode)) throw new SessionError('invalid_request', `posture.codex.mode must be one of ${CODEX_SESSION_MODES.join(', ')}`)
      codex.mode = value.codex.mode as NonNullable<AgentSessionPosture['codex']>['mode']
    }
    if (value.codex.developerInstructions !== undefined) {
      if (typeof value.codex.developerInstructions !== 'string') throw new SessionError('invalid_request', 'posture.codex.developerInstructions must be a string')
      codex.developerInstructions = value.codex.developerInstructions
    }
    for (const key of ['model', 'reasoningEffort'] as const) {
      if (value.codex[key] === undefined) continue
      if (typeof value.codex[key] !== 'string' || value.codex[key] === '') throw new SessionError('invalid_request', `posture.codex.${key} must be a non-empty string`)
      codex[key] = value.codex[key]
    }
    posture.codex = codex
  }
  return posture
}

export function parseCreateSession(body: Record<string, unknown>, families: Pick<SessionFamilyRegistry, 'has' | 'ids'>): CreateSessionRequest {
  if (typeof body.family !== 'string' || !families.has(body.family)) throw new SessionError('invalid_request', `family must be one of ${families.ids().join(', ')}`)
  const posture = parsePosture(body.posture)
  return { family: body.family, ...(posture ? { posture } : {}) }
}

export function parsePrompt(body: Record<string, unknown>): SessionPromptRequest {
  const text = body.text
  if (typeof text !== 'string' || text.trim() === '') throw new SessionError('invalid_request', 'text must be a non-empty string')
  if (text.length > SESSION_PROMPT_MAX_LENGTH) throw new SessionError('invalid_request', `text must be at most ${SESSION_PROMPT_MAX_LENGTH} characters`)
  return { text }
}

function parseAfter(value: string | undefined): number {
  if (value === undefined || value === '') return 0
  const after = Number(value)
  if (!Number.isInteger(after) || after < 0) throw new SessionError('invalid_request', 'after must be a non-negative integer')
  return after
}

export function sessionRoutes(sessions: SessionManager, options: SessionRoutesOptions = {}) {
  const heartbeatMs = options.heartbeatMs ?? SESSION_EVENTS_HEARTBEAT_MS
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof SessionError || error instanceof ProjectError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })

  const projectOf = (c: Context<AppEnv>) => getProjectBySlug(c.var.db, c.req.param('slug')!)

  function sessionOf(c: Context<AppEnv>): AgentSession {
    const id = c.req.param('id')!
    const session = sessions.get(id)
    if (!session || session.projectId !== projectOf(c).id) throw new SessionError('not_found', `No session with id "${id}" in this project`)
    return session
  }

  const refusal = (c: Context<AppEnv>, result: GateRefusal) => c.json<ApiErrorBody>({ error: { code: result.code, message: result.reason } }, result.status)
  const access = requireSessionAccess(sessions)

  app.get('/:slug/sessions', (c) => {
    const project = projectOf(c)
    const visible = sessions.list(project.id).filter(session => canAccessSession(c.var.actor, session))
    const allowed = new Set<AgentSessionFamily>()
    let firstRefusal: GateRefusal | undefined
    for (const family of c.var.families.ids()) {
      const result = gateSessionFamily(c.var, c.var.actor, project, family)
      if (result.allowed) allowed.add(family)
      else firstRefusal ??= result
    }
    if (!allowed.size && firstRefusal) return refusal(c, firstRefusal)
    return c.json<SessionListResponse>({ sessions: visible.filter(session => allowed.has(session.family)) })
  })

  app.post('/:slug/sessions', async (c) => {
    const project = projectOf(c)
    const input = parseCreateSession(await readJson(c), c.var.families)
    const result = gateSessionFamily(c.var, c.var.actor, project, input.family)
    if (!result.allowed) return refusal(c, result)
    const session = sessions.create({ projectId: project.id, family: input.family, actorId: c.var.actor.id, cwd: sourcePath(project.source), posture: input.posture })
    return c.json<SessionResponse>({ session }, 201)
  })

  app.get('/:slug/sessions/:id', access, c => c.json<SessionResponse>({ session: sessionOf(c) }))

  app.post('/:slug/sessions/:id/prompt', access, async (c) => {
    const { id } = sessionOf(c)
    const { text } = parsePrompt(await readJson(c))
    return c.json<SessionResponse>({ session: await sessions.prompt(id, text) }, 202)
  })

  app.post('/:slug/sessions/:id/cancel', access, async c => c.json<SessionResponse>({ session: await sessions.cancel(sessionOf(c).id) }))

  app.get('/:slug/sessions/:id/events', access, (c) => {
    const session = sessionOf(c)
    const after = parseAfter(c.req.query('after'))

    return streamSSE(c, async (stream) => {
      if (sessions.signal.aborted) return
      const done = new Promise<void>((resolve) => {
        stream.onAbort(resolve)
        sessions.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      let last = after
      let replaying = true
      const buffered: SessionMessage[] = []
      const send = (message: SessionMessage) => {
        if (message.type === 'status') return stream.writeSSE({ event: SESSION_STATUS_EVENT_NAME, data: JSON.stringify({ status: message.status } satisfies SessionStatusEvent) })
        if (message.event.seq <= last) return Promise.resolve()
        last = message.event.seq
        return stream.writeSSE({ event: SESSION_EVENT_NAME, id: String(message.event.seq), data: JSON.stringify(message.event) })
      }
      // Subscribed before the replay query so nothing appended in between is lost; duplicates are dropped by seq.
      const unsubscribe = sessions.subscribe(session.id, (message) => {
        if (replaying) buffered.push(message)
        else void send(message)
      })
      const heartbeat = setInterval(() => void stream.write(': ping\n\n'), heartbeatMs)
      try {
        await stream.write(': connected\n\n')
        for (const event of sessions.events(session.id, { after })) await send({ type: 'event', event })
        const current = sessions.get(session.id)
        if (current) await send({ type: 'status', status: current.status })
        replaying = false
        for (const message of buffered.splice(0)) await send(message)
        await done
      }
      finally {
        clearInterval(heartbeat)
        unsubscribe()
      }
    })
  })

  return app
}
