import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chatAgentOptionsPath, projectRegistryPath, projectThreadPath, projectThreadsPath, threadCancelPath, threadPromptPath, threadReadPath, type Actor, type AgentSessionEvent, type AgentSessionEventKind, type ApiErrorBody, type ChatAgentOptionsResponse, type ChatThread, type ChatThreadListResponse, type ChatThreadPromptResponse, type ChatThreadResponse, type PluginTypeId, type Project, type RegistryResponse } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { FAKE_ACP_AGENT, fakeBins, fakeClaude } from '../acp/test-support'
import { listActivityEvents } from '../activity'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { pluginInstances } from '../db/schema'
import { addRole } from '../grants/test-access'
import { createPluginInstance } from '../plugins/instances/instances'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject, sourcePath } from '../projects/projects'
import { startPlatform, type Platform } from '../platform'
import type { SessionManager, SessionMessage } from '../sessions'
import { createTempDataDir, type TempDataDir } from '../testing'
import { threadTitle } from './service'

let temp: TempDataDir | undefined
let platform: Platform | undefined

afterEach(async () => {
  await platform?.sessions.close()
  platform?.close()
  platform = undefined
  temp?.cleanup()
  temp = undefined
})

const ADMIN: Actor = { id: 'admin-actor', username: 'admin', displayName: 'Admin', roles: ['admin'] }
const DEVELOPER: Actor = { id: 'dev-actor', username: 'dev', displayName: 'Dev', roles: ['developer'] }

function boot(bins = fakeBins): Platform {
  temp ??= createTempDataDir()
  platform = startPlatform(temp.root, { acp: { bins, killTimeoutMs: 1000 } })
  return platform
}

const as = (actor: Actor): AuthStrategy => ({ name: 'development', resolve: () => actor })

function call(p: Platform, method: string, path: string, body?: unknown, actor: Actor = ADMIN) {
  const app = createApp({ db: p.db, paths: p.paths, auth: as(actor), pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets, sessions: p.sessions })
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return app.request(path, init)
}

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status)
  return res.json() as Promise<T>
}

async function errorOf(res: Response) {
  return { status: res.status, code: ((await res.json()) as ApiErrorBody).error.code }
}

async function project(p: Platform, slug = 'alpha'): Promise<Project> {
  const path = join(temp!.root, '..', 'repos', slug)
  mkdirSync(path, { recursive: true })
  const created = await createProject(p.db, { name: slug, slug, source: { kind: 'local-path', path } })
  setEnabledModules(p.db, created.id, ['agent-hub'])
  return created
}

/** Stands in for a passing connection test: readiness only reads the stored result. */
function healthyPlugin(p: Platform, projectId: string, type: PluginTypeId, config: Record<string, unknown> = {}): void {
  const instance = createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type, scope: 'project', projectId, config, secrets: {} })
  p.db.update(pluginInstances).set({ health: { healthy: true }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, instance.id)).run()
}

async function createThread(p: Platform, body: unknown, actor: Actor = ADMIN): Promise<ChatThreadResponse> {
  return json<ChatThreadResponse>(await call(p, 'POST', projectThreadsPath('alpha'), body, actor), 201)
}

async function getThread(p: Platform, id: string, actor: Actor = ADMIN): Promise<ChatThreadResponse> {
  return json<ChatThreadResponse>(await call(p, 'GET', projectThreadPath('alpha', id), undefined, actor), 200)
}

async function until(read: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await read())) {
    if (Date.now() > deadline) throw new Error('Condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function waitFor(sessions: SessionManager, id: string, kind: AgentSessionEventKind): Promise<AgentSessionEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`No ${kind} event`)) }, 15_000)
    const unsubscribe = sessions.subscribe(id, (message: SessionMessage) => {
      if (message.type !== 'event' || message.event.kind !== kind) return
      clearTimeout(timer)
      unsubscribe()
      resolve(message.event)
    })
  })
}

async function grantDeveloper(p: Platform, rungs: Record<string, string>): Promise<void> {
  addRole(p.db, 'developer')
  await json(await call(p, 'PUT', '/grants', { role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs }), 200)
}

describe('chat agents in the registry', () => {
  it('lists Claude Code once its plugin is healthy, and Codex once that one is too', async () => {
    const p = boot()
    const alpha = await project(p)
    const agents = async () => (await json<RegistryResponse>(await call(p, 'GET', projectRegistryPath('alpha')), 200)).agents

    expect(await agents()).toEqual([])
    healthyPlugin(p, alpha.id, 'claude-code')
    expect(await agents()).toEqual([{ id: 'claude-code', capabilityId: 'chat-claude-code', label: 'Claude Code', description: expect.any(String), family: 'claude-code', avatar: 'i-lucide-sparkles' }])
    healthyPlugin(p, alpha.id, 'codex')
    expect((await agents()).map(agent => [agent.id, agent.capabilityId, agent.family])).toEqual([['claude-code', 'chat-claude-code', 'claude-code'], ['codex', 'chat-codex', 'codex']])
  })

  it('hides an agent from a role below the chat rung', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'claude-code')
    healthyPlugin(p, alpha.id, 'codex')
    await grantDeveloper(p, { 'chat-claude-code': 'none' })
    const registry = await json<RegistryResponse>(await call(p, 'GET', projectRegistryPath('alpha'), undefined, DEVELOPER), 200)
    expect(registry.agents.map(agent => agent.id)).toEqual(['codex'])
  })
})

describe('chat threads', () => {
  it('records a run.started event with the issue ids and a thread link only for runs', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')

    await createThread(p, { agentId: 'codex' })
    const run = await createThread(p, { agentId: 'codex', issueIds: ['cm-1', 'cm-2'] })
    const { events } = listActivityEvents(p.db, alpha.id, { types: ['run.started'] })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Codex run: cm-1, cm-2',
      link: `/p/alpha?thread=${run.thread.id}`,
      payload: { threadId: run.thread.id, agentId: 'codex', sessionId: run.session.id, issueIds: ['cm-1', 'cm-2'] },
    })
    expect((await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), { agentId: 'codex', issueIds: [] }))).code).toBe('invalid_request')
  })

  it('runs a prompt in a session on the project checkout and tracks working and unread', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')

    const created = await createThread(p, { agentId: 'codex' })
    expect(created.thread).toMatchObject({ agentId: 'codex', actorId: ADMIN.id, title: null, model: null, effort: null, unread: false, working: false, currentSessionId: created.session.id })
    expect(created.session).toMatchObject({ family: 'codex', cwd: sourcePath(alpha.source), actorId: ADMIN.id, posture: null })
    expect(created.sessions.map(s => s.sessionId)).toEqual([created.session.id])

    const turnEnd = waitFor(p.sessions, created.session.id, 'turn_end')
    const prompted = await json<ChatThreadPromptResponse>(await call(p, 'POST', threadPromptPath('alpha', created.thread.id), { text: 'hang' }), 202)
    expect(prompted.thread).toMatchObject({ working: true, unread: false, title: 'hang' })
    expect(p.acpHarness.list().map(session => session.cwd)).toEqual([sourcePath(alpha.source)])

    const listed = await json<ChatThreadListResponse>(await call(p, 'GET', projectThreadsPath('alpha')), 200)
    expect(listed.threads.map(t => [t.id, t.working, t.unread])).toEqual([[created.thread.id, true, false]])

    const busy = await call(p, 'POST', threadPromptPath('alpha', created.thread.id), { text: 'again' })
    expect(await errorOf(busy)).toEqual({ status: 409, code: 'session_busy' })

    // A turn that ends while nobody is looking leaves the thread unread.
    await p.sessions.cancel(created.session.id)
    await turnEnd
    await until(async () => (await getThread(p, created.thread.id)).thread.unread)
    expect((await getThread(p, created.thread.id)).thread).toMatchObject({ working: false, unread: true })

    const read = await json<{ thread: ChatThread }>(await call(p, 'POST', threadReadPath('alpha', created.thread.id)), 200)
    expect(read.thread).toMatchObject({ unread: false, lastReadAt: expect.any(String) })

    const second = waitFor(p.sessions, created.session.id, 'turn_end')
    await json(await call(p, 'POST', threadPromptPath('alpha', created.thread.id), { text: 'hello' }), 202)
    await second
    await until(async () => (await getThread(p, created.thread.id)).thread.unread)
    const after = await getThread(p, created.thread.id)
    expect(after.thread).toMatchObject({ working: false, unread: true, title: 'hang' })
    expect(p.sessions.events(after.session.id).filter(e => e.kind === 'text').map(e => (e as { text: string }).text)).toContain('echo: hello')
  })

  it('stops working and stays read when the sender cancels', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')
    const { thread } = await createThread(p, { agentId: 'codex', title: 'Pinned title' })
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'hang' }), 202)
    const cancelled = await json<ChatThreadPromptResponse>(await call(p, 'POST', threadCancelPath('alpha', thread.id)), 200)
    expect(cancelled.thread).toMatchObject({ working: false, unread: false, title: 'Pinned title' })
  })

  it('launches Claude Code with the chosen model and effort, and starts a new session when they change', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'claude-code', { claudePath: fakeClaude(temp!.root) })

    const options = await json<ChatAgentOptionsResponse>(await call(p, 'GET', chatAgentOptionsPath('alpha', 'claude-code')), 200)
    expect(options.options).toMatchObject({ agentId: 'claude-code', family: 'claude-code' })
    expect(options.options.models.map(m => m.value)).toEqual(['opus', 'sonnet', 'haiku'])
    expect(options.options.efforts.map(e => e.value)).toEqual(['low', 'medium', 'high'])

    const created = await createThread(p, { agentId: 'claude-code', model: 'opus', effort: 'high' })
    expect(created.session.posture).toEqual({ flags: ['--model', 'opus', '--settings', '{"effortLevel":"high"}'] })

    const turnEnd = waitFor(p.sessions, created.session.id, 'turn_end')
    await json(await call(p, 'POST', threadPromptPath('alpha', created.thread.id), { text: 'launch-env' }), 202)
    await turnEnd
    const echoed = p.sessions.events(created.session.id).find(e => e.kind === 'text' && e.text.includes('"args"'))
    const args = (JSON.parse((echoed as { text: string }).text) as { args: string[] }).args
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus', '--settings', '{"effortLevel":"high"}']))
    expect(p.sessions.get(created.session.id)!.cwd).toBe(sourcePath(alpha.source))

    const retitled = await json<ChatThreadResponse>(await call(p, 'PATCH', projectThreadPath('alpha', created.thread.id), { title: 'Renamed' }), 200)
    expect(retitled.session.id).toBe(created.session.id)

    const switched = await json<ChatThreadResponse>(await call(p, 'PATCH', projectThreadPath('alpha', created.thread.id), { model: 'sonnet', effort: null }), 200)
    expect(switched.thread).toMatchObject({ title: 'Renamed', model: 'sonnet', effort: null })
    expect(switched.session.id).not.toBe(created.session.id)
    expect(switched.session.posture).toEqual({ flags: ['--model', 'sonnet'] })
    expect(switched.sessions.map(s => [s.sessionId, s.model, s.effort])).toEqual([[created.session.id, 'opus', 'high'], [switched.session.id, 'sonnet', null]])

    expect(await errorOf(await call(p, 'PATCH', projectThreadPath('alpha', created.thread.id), { model: 'gpt-5' }))).toEqual({ status: 400, code: 'invalid_request' })
  })

  it('refuses a model or effort change mid-turn and any Codex choice before a Codex session has run', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')

    const options = await json<ChatAgentOptionsResponse>(await call(p, 'GET', chatAgentOptionsPath('alpha', 'codex')), 200)
    expect(options.options).toEqual({ agentId: 'codex', family: 'codex', models: [], efforts: [] })
    expect(await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), { agentId: 'codex', model: 'gpt-5' }))).toEqual({ status: 400, code: 'invalid_request' })

    const { thread } = await createThread(p, { agentId: 'codex' })
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'hang' }), 202)
    expect(await errorOf(await call(p, 'PATCH', projectThreadPath('alpha', thread.id), { effort: 'high' }))).toEqual({ status: 409, code: 'thread_busy' })
    await json(await call(p, 'POST', threadCancelPath('alpha', thread.id)), 200)
  })

  it('validates input and keeps threads per actor', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')
    await grantDeveloper(p, {})

    expect(await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), { agentId: 'nobody' }))).toEqual({ status: 404, code: 'not_found' })
    expect(await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), {}))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call(p, 'POST', projectThreadsPath('missing'), { agentId: 'codex' }))).toEqual({ status: 404, code: 'not_found' })

    const { thread } = await createThread(p, { agentId: 'codex' })
    expect(await errorOf(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: '  ' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call(p, 'GET', projectThreadPath('alpha', thread.id), undefined, DEVELOPER))).toEqual({ status: 404, code: 'not_found' })

    const own = await createThread(p, { agentId: 'codex' }, DEVELOPER)
    expect((await json<ChatThreadListResponse>(await call(p, 'GET', projectThreadsPath('alpha'), undefined, DEVELOPER), 200)).threads.map(t => t.id)).toEqual([own.thread.id])
    expect((await json<ChatThreadListResponse>(await call(p, 'GET', projectThreadsPath('alpha', 'codex')), 200)).threads.map(t => t.id)).toEqual([thread.id])
  })

  it('refuses an actor below the chat rung on every route', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'claude-code')
    const { thread } = await createThread(p, { agentId: 'claude-code' })
    await grantDeveloper(p, { 'chat-claude-code': 'none', 'chat-codex': 'none' })

    const refused = [
      await call(p, 'GET', projectThreadsPath('alpha'), undefined, DEVELOPER),
      await call(p, 'GET', projectThreadsPath('alpha', 'claude-code'), undefined, DEVELOPER),
      await call(p, 'POST', projectThreadsPath('alpha'), { agentId: 'claude-code' }, DEVELOPER),
      await call(p, 'GET', chatAgentOptionsPath('alpha', 'claude-code'), undefined, DEVELOPER),
    ]
    for (const res of refused) expect(await errorOf(res)).toEqual({ status: 403, code: 'not_granted' })

    // The developer's own thread from before the grant was lowered is refused too.
    await json(await call(p, 'PUT', '/grants', { role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs: {} }), 200)
    const own = await createThread(p, { agentId: 'claude-code' }, DEVELOPER)
    await json(await call(p, 'PUT', '/grants', { role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs: { 'chat-claude-code': 'none' } }), 200)
    for (const [method, path, body] of [
      ['GET', projectThreadPath('alpha', own.thread.id)],
      ['PATCH', projectThreadPath('alpha', own.thread.id), { title: 'x' }],
      ['POST', threadReadPath('alpha', own.thread.id)],
      ['POST', threadPromptPath('alpha', own.thread.id), { text: 'hi' }],
      ['POST', threadCancelPath('alpha', own.thread.id)],
    ] as const) {
      expect(await errorOf(await call(p, method, path, body, DEVELOPER))).toEqual({ status: 403, code: 'not_granted' })
    }
    expect(thread.actorId).toBe(ADMIN.id)
  })

  it('refuses chat once the plugin is no longer ready', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')
    const { thread } = await createThread(p, { agentId: 'codex' })
    p.db.update(pluginInstances).set({ health: { healthy: false, reason: 'logged out' } }).run()
    expect(await errorOf(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'hi' }))).toEqual({ status: 409, code: 'not_ready' })
  })
})

describe('Codex models and reasoning effort', () => {
  const optionsOf = async (p: Platform) => (await json<ChatAgentOptionsResponse>(await call(p, 'GET', chatAgentOptionsPath('alpha', 'codex')), 200)).options
  const patch = (p: Platform, id: string, body: unknown) => call(p, 'PATCH', projectThreadPath('alpha', id), body)
  async function turn(p: Platform, thread: ChatThreadResponse, text: string): Promise<string[]> {
    const ended = waitFor(p.sessions, thread.session.id, 'turn_end')
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.thread.id), { text }), 202)
    await ended
    return p.sessions.events(thread.session.id).flatMap(e => (e.kind === 'text' ? [e.text] : []))
  }

  it('offers what Codex listed once a session ran and launches a new session with the chosen model and effort', async () => {
    const p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')
    expect(await optionsOf(p)).toEqual({ agentId: 'codex', family: 'codex', models: [], efforts: [] })

    const first = await createThread(p, { agentId: 'codex' })
    expect(await turn(p, first, 'model')).toEqual(['model:gpt-fast/medium'])
    expect(await optionsOf(p)).toEqual({
      agentId: 'codex',
      family: 'codex',
      models: [{ value: 'gpt-fast', label: 'Fast', description: 'Quick answers.' }, { value: 'gpt-deep', label: 'Deep', description: 'Long reasoning.' }],
      efforts: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
    })

    const deep = await json<ChatThreadResponse>(await patch(p, first.thread.id, { model: 'gpt-deep' }), 200)
    expect(deep.session.id).not.toBe(first.session.id)
    expect(deep.session.posture).toEqual({ codex: { model: 'gpt-deep' } })
    expect(deep.sessions.map(s => [s.model, s.effort])).toEqual([[null, null], ['gpt-deep', null]])
    expect(await turn(p, deep, 'model')).toEqual(['model:gpt-deep/high'])
    expect((await optionsOf(p)).efforts.map(e => e.value)).toEqual(['low', 'medium', 'high', 'xhigh'])

    const xhigh = await json<ChatThreadResponse>(await patch(p, first.thread.id, { effort: 'xhigh' }), 200)
    expect(xhigh.session.posture).toEqual({ codex: { model: 'gpt-deep', reasoningEffort: 'xhigh' } })
    expect(await turn(p, xhigh, 'model')).toEqual(['model:gpt-deep/xhigh'])
    expect(await turn(p, xhigh, 'env:INITIAL_AGENT_MODE,CODEX_CONFIG')).toContain(JSON.stringify({ INITIAL_AGENT_MODE: 'read-only', CODEX_CONFIG: JSON.stringify({ model: 'gpt-deep', model_reasoning_effort: 'xhigh' }) }))

    expect(await errorOf(await patch(p, first.thread.id, { model: 'gpt-unknown' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await patch(p, first.thread.id, { model: 'gpt-fast' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await patch(p, first.thread.id, { effort: 'max' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), { agentId: 'codex', model: 'gpt-fast', effort: 'xhigh' }))).toEqual({ status: 400, code: 'invalid_request' })
    const created = await createThread(p, { agentId: 'codex', model: 'gpt-fast', effort: 'low' })
    expect(created.session.posture).toEqual({ codex: { model: 'gpt-fast', reasoningEffort: 'low' } })
    expect(await turn(p, created, 'model')).toEqual(['model:gpt-fast/low'])
  })

  it('keeps a thread\'s accepted model after a restart empties the list, and offers nothing while Codex is not logged in', async () => {
    let p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')
    const first = await createThread(p, { agentId: 'codex' })
    await turn(p, first, 'hello')
    const deep = await json<ChatThreadResponse>(await patch(p, first.thread.id, { model: 'gpt-deep' }), 200)

    await p.sessions.close()
    p.close()
    p = boot({ ...fakeBins, codexAdapter: { command: 'env', args: ['FAKE_ACP_AUTH=none', process.execPath, FAKE_ACP_AGENT] } })
    expect(await optionsOf(p)).toEqual({ agentId: 'codex', family: 'codex', models: [], efforts: [] })
    expect(await errorOf(await call(p, 'POST', threadPromptPath('alpha', first.thread.id), { text: 'hello' }))).toEqual({ status: 409, code: 'auth_required' })
    expect(await optionsOf(p)).toEqual({ agentId: 'codex', family: 'codex', models: [], efforts: [] })
    expect(await errorOf(await patch(p, first.thread.id, { model: 'gpt-fast' }))).toEqual({ status: 400, code: 'invalid_request' })
    const renamed = await json<ChatThreadResponse>(await patch(p, first.thread.id, { title: 'Deep thoughts' }), 200)
    expect(renamed.session.id).toBe(deep.session.id)
    expect(await errorOf(await patch(p, first.thread.id, { effort: 'high' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect((await json<ChatThreadResponse>(await patch(p, first.thread.id, { model: 'gpt-deep', effort: null }), 200)).session.id).toBe(deep.session.id)
  })
})

describe('threads across a restart', () => {
  it('clears working for a turn the restart cut off and keeps the thread on its session', async () => {
    let p = boot()
    const alpha = await project(p)
    healthyPlugin(p, alpha.id, 'codex')
    const { thread, session } = await createThread(p, { agentId: 'codex' })
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'hang' }), 202)
    await p.sessions.close()
    p.close()

    p = boot()
    const after = await getThread(p, thread.id)
    expect(after.thread).toMatchObject({ working: false, currentSessionId: session.id })
    const turnEnd = waitFor(p.sessions, session.id, 'turn_end')
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'history' }), 202)
    await turnEnd
    await until(async () => (await getThread(p, thread.id)).thread.unread)
  })
})

describe('thread titles', () => {
  it('flattens whitespace and truncates long prompts', () => {
    expect(threadTitle('  fix\n the   build ')).toBe('fix the build')
    const long = threadTitle('word '.repeat(40))
    expect(long.length).toBeLessThanOrEqual(80)
    expect(long.endsWith('…')).toBe(true)
  })
})
