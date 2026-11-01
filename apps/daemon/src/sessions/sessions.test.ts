import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { projectSessionsPath, sessionCancelPath, sessionDecisionPath, sessionDecisionsPath, sessionEventsPath, sessionPromptPath, type ActivityListResponse, type Actor, type AgentSession, type AgentSessionEvent, type AgentSessionEventKind, type ApiErrorBody, type DecisionListResponse, type Project, type SessionListResponse, type SessionResponse } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_ACP_AGENT, fakeBins } from '../acp/test-support'
import { createTestApp } from '../testing/platform'
import type { AuthStrategy } from '../auth'
import { addRole } from '../grants/test-access'
import { createPluginInstance } from '../plugins/instances/instances'
import { pluginInstances } from '../db/schema'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject } from '../projects/projects'
import { startAcpPlatform, type AcpPlatform, type AcpPlatformOptions } from '../chat-claude-code/test-support'
import { createTempDataDir, type TempDataDir } from '../testing'
import { resolveSessionSettings } from './config'
import type { SessionManager, SessionMessage } from './manager'

let temp: TempDataDir | undefined
let platform: AcpPlatform | undefined

afterEach(async () => {
  await platform?.sessions.close()
  platform?.close()
  platform = undefined
  temp?.cleanup()
  temp = undefined
})

function boot(options: AcpPlatformOptions = {}): AcpPlatform {
  temp ??= createTempDataDir()
  platform = startAcpPlatform(temp.root, { acp: { bins: fakeBins, killTimeoutMs: 1000 }, ...options })
  return platform
}

async function projectWithCodex(p: AcpPlatform, slug = 'alpha'): Promise<Project> {
  const path = join(temp!.root, '..', 'repos', slug)
  mkdirSync(path, { recursive: true })
  const project = await createProject(p.db, { name: slug, slug, source: { kind: 'local-path', path } })
  setEnabledModules(p.db, project.id, ['agent-hub'])
  const instance = createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type: 'codex', scope: 'project', projectId: project.id, config: {}, secrets: {} })
  markHealthy(p, instance.id)
  return project
}

/** Stands in for a passing connection test: the chat gate only reads the stored result. */
function markHealthy(p: AcpPlatform, instanceId: string): void {
  p.db.update(pluginInstances).set({ health: { healthy: true }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, instanceId)).run()
}

const ADMIN: Actor = { id: 'admin-actor', username: 'admin', displayName: 'Admin', roles: ['admin'] }
const DEVELOPER: Actor = { id: 'dev-actor', username: 'dev', displayName: 'Dev', roles: ['developer'] }
const OTHER: Actor = { id: 'other-actor', username: 'other', displayName: 'Other', roles: ['developer'] }

const as = (actor: Actor): AuthStrategy => ({ name: 'development', resolve: () => actor })

const appOf = (p: AcpPlatform, actor?: Actor) => createTestApp({ db: p.db, paths: p.paths, ...(actor ? { auth: as(actor) } : {}), pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets, families: p.families, runtime: p.runtime })

function call(p: AcpPlatform, method: string, path: string, body?: unknown, actor?: Actor) {
  const init: RequestInit = { method }
  if (body !== undefined) init.headers = { 'content-type': 'application/json' }
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body)
  return appOf(p, actor).request(path, init)
}

async function createSession(p: AcpPlatform, slug = 'alpha', body: unknown = { family: 'codex' }): Promise<AgentSession> {
  const res = await call(p, 'POST', projectSessionsPath(slug), body)
  expect(res.status, await res.clone().text()).toBe(201)
  return ((await res.json()) as SessionResponse).session
}

async function prompt(p: AcpPlatform, slug: string, id: string, text: string): Promise<Response> {
  return call(p, 'POST', sessionPromptPath(slug, id), { text })
}

async function errorOf(res: Response) {
  return { status: res.status, code: ((await res.json()) as ApiErrorBody).error.code }
}

function waitFor(sessions: SessionManager, id: string, kind: AgentSessionEventKind, timeoutMs = 10_000): Promise<AgentSessionEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`No ${kind} event within ${timeoutMs}ms`)) }, timeoutMs)
    const unsubscribe = sessions.subscribe(id, (message: SessionMessage) => {
      if (message.type !== 'event' || message.event.kind !== kind) return
      clearTimeout(timer)
      unsubscribe()
      resolve(message.event)
    })
  })
}

interface Frame {
  event: string
  id?: string
  data: string
}

/** Reads an SSE body frame by frame so a test can assert on the live tail of a stream. */
class SseReader {
  readonly frames: Frame[] = []
  private text = ''
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private readonly decoder = new TextDecoder()

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader()
  }

  async until(predicate: (frames: Frame[]) => boolean, timeoutMs = 10_000): Promise<Frame[]> {
    const deadline = Date.now() + timeoutMs
    while (!predicate(this.frames)) {
      const result = await Promise.race([this.reader.read(), new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now())))])
      if (result === 'timeout' || result.done) throw new Error(`Stream ended or timed out; got ${JSON.stringify(this.text)}`)
      this.text += this.decoder.decode(result.value, { stream: true })
      this.parse()
    }
    return this.frames
  }

  private parse(): void {
    const parts = this.text.split('\n\n')
    this.text = parts.pop() ?? ''
    for (const part of parts) {
      const frame: Frame = { event: 'message', data: '' }
      let comment = true
      for (const line of part.split('\n')) {
        if (line.startsWith(':')) continue
        comment = false
        if (line.startsWith('event: ')) frame.event = line.slice(7)
        else if (line.startsWith('id: ')) frame.id = line.slice(4)
        else if (line.startsWith('data: ')) frame.data += line.slice(6)
      }
      if (!comment) this.frames.push(frame)
    }
  }

  cancel(): Promise<void> {
    return this.reader.cancel()
  }
}

const sessionFrames = (frames: Frame[]) => frames.filter(frame => frame.event === 'session').map(frame => JSON.parse(frame.data) as AgentSessionEvent)
const statusFrames = (frames: Frame[]) => frames.filter(frame => frame.event === 'status').map(frame => (JSON.parse(frame.data) as { status: string }).status)

async function openStream(p: AcpPlatform, slug: string, id: string, after?: number): Promise<SseReader> {
  const res = await appOf(p).request(sessionEventsPath(slug, id, after))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('text/event-stream')
  return new SseReader(res.body!)
}

describe('agent sessions', () => {
  it('creates a session with the project checkout, writes session.started and lists it', async () => {
    const p = boot()
    const project = await projectWithCodex(p)
    const session = await createSession(p)
    expect(session).toMatchObject({ projectId: project.id, family: 'codex', actorId: expect.any(String), cwd: project.source.path, upstreamSessionId: null, status: 'idle', posture: null })

    const list = (await (await call(p, 'GET', projectSessionsPath('alpha'))).json()) as SessionListResponse
    expect(list.sessions).toEqual([session])
    const one = (await (await call(p, 'GET', `${projectSessionsPath('alpha')}/${session.id}`)).json()) as SessionResponse
    expect(one.session).toEqual(session)

    const activity = (await (await call(p, 'GET', `/projects/alpha/activity`)).json()) as ActivityListResponse
    expect(activity.events).toHaveLength(1)
    expect(activity.events[0]).toMatchObject({ type: 'session.started', title: 'Codex session started', payload: { sessionId: session.id, family: 'codex' } })

    await createProject(p.db, { name: 'beta', slug: 'beta', source: { kind: 'local-path', path: project.source.path } })
    expect(await errorOf(await call(p, 'GET', `${projectSessionsPath('beta')}/${session.id}`))).toEqual({ status: 404, code: 'not_found' })
    expect(await errorOf(await call(p, 'POST', projectSessionsPath('alpha'), { family: 'gemini' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call(p, 'POST', projectSessionsPath('alpha'), { family: 'codex', posture: { codex: { mode: 'agent' } } }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call(p, 'POST', projectSessionsPath('alpha'), { family: 'codex', posture: { codex: { model: 'gpt 5\napprovals_reviewer = "auto_review"' } } }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call(p, 'POST', projectSessionsPath('alpha'), { family: 'codex', posture: { codex: { reasoningEffort: 42 } } }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(p.sessions.configOptions(project.id, 'codex')).toEqual([])
    expect(await errorOf(await prompt(p, 'alpha', session.id, ''))).toEqual({ status: 400, code: 'invalid_request' })
  })

  it('refuses a prompt when the family plugin is not set up, without logging it', async () => {
    const p = boot()
    const project = await createProject(p.db, { name: 'bare', slug: 'bare', source: { kind: 'local-path', path: temp!.root } })
    setEnabledModules(p.db, project.id, ['agent-hub'])
    expect(await errorOf(await call(p, 'POST', projectSessionsPath('bare'), { family: 'codex' }))).toEqual({ status: 409, code: 'not_ready' })
    const session = p.sessions.create({ projectId: project.id, family: 'codex', actorId: 'someone', cwd: temp!.root })
    await expect(p.sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', status: 422 })
    expect(p.sessions.events(session.id)).toEqual([])
    expect(p.sessions.get(session.id)?.status).toBe('idle')
  })

  it('runs a turn, logs every event with a growing seq and reports session_busy mid-turn', async () => {
    const p = boot()
    await projectWithCodex(p)
    const session = await createSession(p)
    const turnEnd = waitFor(p.sessions, session.id, 'turn_end')
    const res = await prompt(p, 'alpha', session.id, 'hello')
    expect(res.status).toBe(202)
    expect(((await res.json()) as SessionResponse).session).toMatchObject({ status: 'prompting', upstreamSessionId: expect.stringMatching(/^fake-/) })
    await turnEnd

    const events = p.sessions.events(session.id)
    expect(events.map(event => event.kind)).toEqual(['prompt', 'text', 'turn_end'])
    expect(events.map(event => event.seq)).toEqual([1, 2, 3])
    expect(events[1]).toMatchObject({ kind: 'text', role: 'agent', text: 'echo: hello' })
    expect(p.sessions.get(session.id)?.status).toBe('live')
    expect(p.sessions.liveCount()).toBe(1)

    const hanging = waitFor(p.sessions, session.id, 'text')
    expect((await prompt(p, 'alpha', session.id, 'hang')).status).toBe(202)
    await hanging
    expect(await errorOf(await prompt(p, 'alpha', session.id, 'again'))).toEqual({ status: 409, code: 'session_busy' })
    const cancelled = await call(p, 'POST', sessionCancelPath('alpha', session.id))
    expect(((await cancelled.json()) as SessionResponse).session.status).toBe('live')
    expect(p.sessions.events(session.id, { after: 3 }).map(event => event.kind)).toEqual(['prompt', 'text', 'turn_end'])
    expect(p.sessions.events(session.id).at(-1)).toMatchObject({ kind: 'turn_end', stopReason: 'cancelled', seq: 6 })
  })

  it('replays the log to a stream opened mid-turn and then follows live, in order and without gaps', async () => {
    const p = boot()
    await projectWithCodex(p)
    const session = await createSession(p)
    const working = waitFor(p.sessions, session.id, 'text')
    await prompt(p, 'alpha', session.id, 'hang')
    await working

    const stream = await openStream(p, 'alpha', session.id)
    await stream.until(frames => statusFrames(frames).length > 0)
    expect(sessionFrames(stream.frames).map(event => [event.seq, event.kind])).toEqual([[1, 'prompt'], [2, 'text']])
    expect(statusFrames(stream.frames)).toEqual(['prompting'])

    await call(p, 'POST', sessionCancelPath('alpha', session.id))
    await stream.until(frames => statusFrames(frames).includes('live'))
    const live = sessionFrames(stream.frames)
    expect(live.map(event => [event.seq, event.kind])).toEqual([[1, 'prompt'], [2, 'text'], [3, 'turn_end']])
    expect(stream.frames.filter(frame => frame.event === 'session').map(frame => frame.id)).toEqual(['1', '2', '3'])

    const next = waitFor(p.sessions, session.id, 'turn_end')
    await prompt(p, 'alpha', session.id, 'more')
    await next
    await stream.until(frames => sessionFrames(frames).length >= 6)
    expect(sessionFrames(stream.frames).map(event => event.seq)).toEqual([1, 2, 3, 4, 5, 6])
    await stream.cancel()

    const tail = await openStream(p, 'alpha', session.id, 4)
    await tail.until(frames => statusFrames(frames).length > 0)
    expect(sessionFrames(tail.frames).map(event => event.seq)).toEqual([5, 6])
    await tail.cancel()
    expect(await errorOf(await appOf(p).request(sessionEventsPath('alpha', session.id) + '?after=x'))).toEqual({ status: 400, code: 'invalid_request' })
  })

  it('resumes the same upstream session after a daemon restart', async () => {
    let p = boot()
    await projectWithCodex(p)
    const session = await createSession(p)
    const first = waitFor(p.sessions, session.id, 'turn_end')
    await prompt(p, 'alpha', session.id, 'hello')
    await first
    const upstream = p.sessions.get(session.id)!.upstreamSessionId
    expect(upstream).toMatch(/^fake-/)
    const exited = waitFor(p.sessions, session.id, 'exited')
    await p.sessions.close()
    await expect(exited).resolves.toMatchObject({ kind: 'exited', expected: true })
    p.close()

    p = boot()
    const restored = p.sessions.get(session.id)
    expect(restored).toMatchObject({ id: session.id, status: 'idle', upstreamSessionId: upstream })
    expect(p.sessions.events(session.id).map(event => event.kind)).toEqual(['prompt', 'text', 'turn_end', 'exited'])

    const second = waitFor(p.sessions, session.id, 'turn_end')
    await prompt(p, 'alpha', session.id, 'history')
    await second
    const events = p.sessions.events(session.id)
    expect(events.at(-2)).toMatchObject({ kind: 'text', text: '["(loaded)","history"]', seq: 6 })
    expect(p.sessions.get(session.id)!.upstreamSessionId).toBe(upstream)
    expect(p.acpHarness.list().map(live => live.upstreamSessionId)).toEqual([upstream])
  })

  it('reaps an idle live process, keeps the session and resumes it on the next prompt', async () => {
    const p = boot({ sessions: { idleTimeoutMs: 200, reapIntervalMs: 25 } })
    await projectWithCodex(p)
    const session = await createSession(p)
    const exited = waitFor(p.sessions, session.id, 'exited', 5000)
    await prompt(p, 'alpha', session.id, 'hello')
    await expect(exited).resolves.toMatchObject({ kind: 'exited', expected: true })
    expect(p.sessions.get(session.id)).toMatchObject({ status: 'idle', upstreamSessionId: expect.stringMatching(/^fake-/) })
    expect(p.sessions.liveCount()).toBe(0)

    const resumed = waitFor(p.sessions, session.id, 'turn_end')
    await prompt(p, 'alpha', session.id, 'history')
    await resumed
    expect(p.sessions.events(session.id).find(event => event.kind === 'text' && event.text.includes('loaded'))).toBeDefined()
  })

  it('does not reap a process while a turn is running', async () => {
    const p = boot({ sessions: { idleTimeoutMs: 100, reapIntervalMs: 20 } })
    await projectWithCodex(p)
    const session = await createSession(p)
    const working = waitFor(p.sessions, session.id, 'text')
    await prompt(p, 'alpha', session.id, 'hang')
    await working
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(p.sessions.get(session.id)?.status).toBe('prompting')
    expect(p.sessions.liveCount()).toBe(1)
    await p.sessions.cancel(session.id)
  })

  it('queues a prompt beyond the live cap and runs it once a slot frees', async () => {
    const p = boot({ sessions: { maxLive: 1 } })
    await projectWithCodex(p)
    const a = await createSession(p)
    const b = await createSession(p)
    const working = waitFor(p.sessions, a.id, 'text')
    await prompt(p, 'alpha', a.id, 'hang')
    await working

    const queuedRes = await prompt(p, 'alpha', b.id, 'hello')
    expect(queuedRes.status).toBe(202)
    expect(((await queuedRes.json()) as SessionResponse).session.status).toBe('queued')
    expect(p.sessions.events(b.id).map(event => event.kind)).toEqual(['prompt'])
    expect(await errorOf(await prompt(p, 'alpha', b.id, 'again'))).toEqual({ status: 409, code: 'session_busy' })
    expect(p.sessions.liveCount()).toBe(1)

    const aExited = waitFor(p.sessions, a.id, 'exited')
    const bDone = waitFor(p.sessions, b.id, 'turn_end')
    await call(p, 'POST', sessionCancelPath('alpha', a.id))
    await expect(aExited).resolves.toMatchObject({ expected: true })
    await bDone
    expect(p.sessions.events(b.id).map(event => event.kind)).toEqual(['prompt', 'text', 'turn_end'])
    expect(p.sessions.get(a.id)?.status).toBe('idle')
    expect(p.sessions.get(b.id)?.status).toBe('live')
    expect(p.sessions.liveCount()).toBe(1)
  })

  it('cancels a queued prompt without starting it', async () => {
    const p = boot({ sessions: { maxLive: 1 } })
    await projectWithCodex(p)
    const a = await createSession(p)
    const b = await createSession(p)
    const working = waitFor(p.sessions, a.id, 'text')
    await prompt(p, 'alpha', a.id, 'hang')
    await working
    await prompt(p, 'alpha', b.id, 'hello')
    const cancelled = await call(p, 'POST', sessionCancelPath('alpha', b.id))
    expect(((await cancelled.json()) as SessionResponse).session.status).toBe('idle')
    expect(p.sessions.events(b.id).map(event => event.kind)).toEqual(['prompt', 'turn_end'])
    await p.sessions.cancel(a.id)
  })

  it('surfaces a missing login as auth_required on the prompt and in the log', async () => {
    const p = boot({ acp: { bins: { ...fakeBins, codexAdapter: { command: 'env', args: ['FAKE_ACP_AUTH=none', process.execPath, FAKE_ACP_AGENT] } } } })
    await projectWithCodex(p)
    const session = await createSession(p)
    expect(await errorOf(await prompt(p, 'alpha', session.id, 'hello'))).toEqual({ status: 409, code: 'auth_required' })
    expect(p.sessions.events(session.id).map(event => event.kind)).toEqual(['prompt', 'auth_required', 'turn_end'])
    expect(p.sessions.get(session.id)).toMatchObject({ status: 'idle', upstreamSessionId: null })
    expect(p.sessions.liveCount()).toBe(0)
  })

  it('exposes pending requests of a live turn for a decision to answer', async () => {
    const p = boot()
    await projectWithCodex(p)
    const session = await createSession(p)
    const asked = waitFor(p.sessions, session.id, 'permission_request')
    await prompt(p, 'alpha', session.id, 'permission')
    const request = await asked
    expect(request).toMatchObject({ kind: 'permission_request', requestId: expect.any(String), options: [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'reject', kind: 'reject_once' }] })
    expect('respond' in request).toBe(false)
    const requestId = request.kind === 'permission_request' ? request.requestId : ''
    expect(p.sessions.pendingRequests(session.id)).toEqual([{ requestId, kind: 'permission_request' }])
    expect(p.sessions.respondToQuestion(session.id, requestId, { action: 'cancel' })).toBe(false)

    const done = waitFor(p.sessions, session.id, 'turn_end')
    expect(p.sessions.respondToPermission(session.id, requestId, { outcome: { outcome: 'selected', optionId: 'allow' } })).toBe(true)
    await done
    expect(p.sessions.pendingRequests(session.id)).toEqual([])
    expect(p.sessions.respondToPermission(session.id, requestId, { outcome: { outcome: 'selected', optionId: 'allow' } })).toBe(false)
    expect(p.sessions.events(session.id).find(event => event.kind === 'text')).toMatchObject({ text: 'permission:{"outcome":"selected","optionId":"allow"}' })
  })

  it('ends open streams and kills live processes on close', async () => {
    const p = boot()
    await projectWithCodex(p)
    const session = await createSession(p)
    const done = waitFor(p.sessions, session.id, 'turn_end')
    await prompt(p, 'alpha', session.id, 'hello')
    await done
    const pid = p.acpHarness.list()[0]!.pid
    const res = await appOf(p).request(sessionEventsPath('alpha', session.id))
    const reader = res.body!.getReader()
    await reader.read()
    await p.sessions.close()
    const ended = (async () => { for (;;) { if ((await reader.read()).done) return true } })()
    await expect(Promise.race([ended, new Promise(resolve => setTimeout(() => resolve('still open'), 3000))])).resolves.toBe(true)
    expect(p.acpHarness.list()).toEqual([])
    await expect(new Promise(resolve => setTimeout(() => { try { process.kill(pid, 0); resolve(true) } catch { resolve(false) } }, 100))).resolves.toBe(false)
  })
})

describe('session access', () => {
  async function grantDeveloper(p: AcpPlatform, rungs: Record<string, string>): Promise<void> {
    addRole(p.db, 'developer')
    const res = await call(p, 'PUT', '/grants', { role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs }, ADMIN)
    expect(res.status, await res.clone().text()).toBe(200)
  }

  const sessionRequests = (id: string): [string, string, unknown?][] => [
    ['GET', `${projectSessionsPath('alpha')}/${id}`],
    ['GET', sessionEventsPath('alpha', id)],
    ['POST', sessionPromptPath('alpha', id), { text: 'hello' }],
    ['POST', sessionCancelPath('alpha', id)],
    ['GET', sessionDecisionsPath('alpha', id)],
    ['POST', sessionDecisionPath('alpha', id, 'some-decision'), { optionKind: 'allow_once' }],
  ]

  const listed = async (p: AcpPlatform, actor: Actor) => {
    const res = await call(p, 'GET', projectSessionsPath('alpha'), undefined, actor)
    expect(res.status, await res.clone().text()).toBe(200)
    return ((await res.json()) as SessionListResponse).sessions.map(session => session.id)
  }

  it('hides another actor\'s session from a non-admin on every route', async () => {
    const p = boot()
    await projectWithCodex(p)
    await grantDeveloper(p, {})
    const adminOwned = await createSession(p)
    const theirs = p.sessions.create({ projectId: adminOwned.projectId, family: 'codex', actorId: OTHER.id, cwd: adminOwned.cwd })

    for (const [method, path, body] of [...sessionRequests(adminOwned.id), ...sessionRequests(theirs.id)]) {
      expect(await errorOf(await call(p, method, path, body, DEVELOPER)), `${method} ${path}`).toEqual({ status: 404, code: 'not_found' })
    }
    expect(await listed(p, DEVELOPER)).toEqual([])
    expect(p.sessions.events(theirs.id)).toEqual([])
  })

  it('refuses an actor whose chat rung is none, even on their own session', async () => {
    const p = boot()
    const project = await projectWithCodex(p)
    await grantDeveloper(p, { 'chat-codex': 'none', 'chat-claude-code': 'none' })
    const own = p.sessions.create({ projectId: project.id, family: 'codex', actorId: DEVELOPER.id, cwd: temp!.root })

    const refused = [
      ...sessionRequests(own.id),
      ['GET', projectSessionsPath('alpha')],
      ['POST', projectSessionsPath('alpha'), { family: 'codex' }],
    ] as [string, string, unknown?][]
    for (const [method, path, body] of refused) {
      expect(await errorOf(await call(p, method, path, body, DEVELOPER)), `${method} ${path}`).toEqual({ status: 403, code: 'not_granted' })
    }
    expect(p.sessions.events(own.id)).toEqual([])
  })

  it('lets the owner and the admin drive a session, including one with no human owner', async () => {
    const p = boot()
    await projectWithCodex(p)
    await grantDeveloper(p, {})
    const res = await call(p, 'POST', projectSessionsPath('alpha'), { family: 'codex' }, DEVELOPER)
    expect(res.status, await res.clone().text()).toBe(201)
    const own = ((await res.json()) as SessionResponse).session
    expect(own.actorId).toBe(DEVELOPER.id)
    const bot = p.sessions.create({ projectId: own.projectId, family: 'codex', actorId: 'bot:reviewer', cwd: own.cwd })

    expect(await listed(p, DEVELOPER)).toEqual([own.id])
    expect((await listed(p, ADMIN)).sort()).toEqual([own.id, bot.id].sort())

    for (const [actor, session] of [[DEVELOPER, own], [ADMIN, own], [ADMIN, bot]] as const) {
      const done = waitFor(p.sessions, session.id, 'turn_end')
      expect((await call(p, 'POST', sessionPromptPath('alpha', session.id), { text: 'hello' }, actor)).status).toBe(202)
      await done
      const one = await call(p, 'GET', `${projectSessionsPath('alpha')}/${session.id}`, undefined, actor)
      expect(((await one.json()) as SessionResponse).session.id).toBe(session.id)
      expect(((await (await call(p, 'GET', sessionDecisionsPath('alpha', session.id), undefined, actor)).json()) as DecisionListResponse).decisions).toEqual([])
      expect((await call(p, 'POST', sessionCancelPath('alpha', session.id), undefined, actor)).status).toBe(200)
      const stream = await appOf(p, actor).request(sessionEventsPath('alpha', session.id))
      expect(stream.status).toBe(200)
      const reader = new SseReader(stream.body!)
      await reader.until(frames => frames.some(frame => frame.event === 'session' && JSON.parse(frame.data).kind === 'turn_end'))
      await reader.cancel()
    }
  })
})

describe('session settings', () => {
  it('reads the reaper timeout and the live cap from the environment', () => {
    expect(resolveSessionSettings({})).toEqual({ idleTimeoutMs: 15 * 60_000, maxLive: 4 })
    expect(resolveSessionSettings({ CM_SESSION_IDLE_TIMEOUT: '90s', CM_SESSION_MAX_LIVE: '2' })).toEqual({ idleTimeoutMs: 90_000, maxLive: 2 })
    expect(() => resolveSessionSettings({ CM_SESSION_IDLE_TIMEOUT: '5' })).toThrow(/CM_SESSION_IDLE_TIMEOUT/)
    expect(() => resolveSessionSettings({ CM_SESSION_MAX_LIVE: '0' })).toThrow(/CM_SESSION_MAX_LIVE/)
  })
})
