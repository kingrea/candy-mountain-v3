import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chatAgentOptionsPath, workspaceRegistryPath, workspaceThreadPath, workspaceThreadsPath, threadCancelPath, threadPromptPath, threadReadPath, type AgentSessionEvent, type AgentSessionEventKind, type ApiErrorBody, type ChatAgentOptionsResponse, type ChatThread, type ChatThreadListResponse, type ChatThreadPromptResponse, type ChatThreadResponse, type PluginTypeId, type Workspace, type RegistryResponse } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listActivityEvents, pluginInstances, THREAD_SESSIONS, threadTitle } from '@candy-mountain/platform-daemon'
import { testKit, type TestActor, type TestKit } from '@candy-mountain/platform-daemon/testing'
import { repositoryPaths, setRepository } from '@candy-mountain/plugin-repository'
import { ACP_SESSIONS, FAKE_ACP_AGENT, fakeBins, fakeClaude, type SessionManager, type SessionMessage } from '@candy-mountain/cap-acp'
import { acpKit, acpTestProduct, type AcpKit } from './test-support'

let kit: AcpKit | undefined

afterEach(async () => {
  await kit?.close()
  kit = undefined
})

function boot(): AcpKit {
  return kit = acpKit({ acp: { bins: fakeBins, killTimeoutMs: 1000 } })
}

function call(p: AcpKit, method: string, path: string, body?: unknown, actor: TestActor = p.admin) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return actor.request(path, init)
}

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status)
  return res.json() as Promise<T>
}

async function errorOf(res: Response) {
  return { status: res.status, code: ((await res.json()) as ApiErrorBody).error.code }
}

async function workspace(p: AcpKit, slug = 'alpha'): Promise<Workspace> {
  const path = join(p.platform.paths.root, '..', 'repos', slug)
  mkdirSync(path, { recursive: true })
  const created = p.workspace({ name: slug, slug, modules: ['agent-hub'] })
  await setRepository(p.db, created.id, { kind: 'local-path', path })
  return created
}

function healthyPlugin(p: AcpKit, workspace: Workspace, type: PluginTypeId, config: Record<string, unknown> = {}): void {
  p.pluginInstance({ type, workspace, config })
}

async function createThread(p: AcpKit, body: unknown, actor: TestActor = p.admin): Promise<ChatThreadResponse> {
  return json<ChatThreadResponse>(await call(p, 'POST', workspaceThreadsPath('alpha'), body, actor), 201)
}

async function getThread(p: AcpKit, id: string, actor: TestActor = p.admin): Promise<ChatThreadResponse> {
  return json<ChatThreadResponse>(await call(p, 'GET', workspaceThreadPath('alpha', id), undefined, actor), 200)
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

const developer = (p: AcpKit, rungs: Record<string, string> = {}) => p.actor({ rungs: { 'chat-claude-code': 'chat', 'chat-codex': 'chat', ...rungs } })

describe('chat agents in the registry', () => {
  it('lists Claude Code once its plugin is healthy, and Codex once that one is too', async () => {
    const p = boot()
    const alpha = await workspace(p)
    const agents = async () => (await json<RegistryResponse>(await call(p, 'GET', workspaceRegistryPath('alpha')), 200)).agents

    expect(await agents()).toEqual([])
    healthyPlugin(p, alpha, 'claude-code')
    expect(await agents()).toEqual([{ id: 'claude-code', capabilityId: 'chat-claude-code', label: 'Claude Code', description: expect.any(String), family: 'claude-code', avatar: 'i-lucide-sparkles' }])
    healthyPlugin(p, alpha, 'codex')
    expect((await agents()).map(agent => [agent.id, agent.capabilityId, agent.family])).toEqual([['claude-code', 'chat-claude-code', 'claude-code'], ['codex', 'chat-codex', 'codex']])
  })

  it('hides an agent from a role below the chat rung', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'claude-code')
    healthyPlugin(p, alpha, 'codex')
    const dev = developer(p, { 'chat-claude-code': 'none' })
    const registry = await json<RegistryResponse>(await call(p, 'GET', workspaceRegistryPath('alpha'), undefined, dev), 200)
    expect(registry.agents.map(agent => agent.id)).toEqual(['codex'])
  })
})

describe('chat threads', () => {
  it('records a run.started event with the issue ids and a thread link only for runs', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')

    await createThread(p, { agentId: 'codex' })
    const run = await createThread(p, { agentId: 'codex', issueIds: ['cm-1', 'cm-2'] })
    const { events } = listActivityEvents(p.db, alpha.id, { types: ['run.started'] })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      title: 'Codex run: cm-1, cm-2',
      link: `/${p.platform.product.config.scope.urlPrefix}/alpha?thread=${run.thread.id}`,
      payload: { threadId: run.thread.id, agentId: 'codex', sessionId: run.session.id, issueIds: ['cm-1', 'cm-2'] },
    })
    expect((await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: 'codex', issueIds: [] }))).code).toBe('invalid_request')
  })

  it('runs a prompt in a session on the workspace checkout and tracks working and unread', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')

    const created = await createThread(p, { agentId: 'codex' })
    expect(created.thread).toMatchObject({ agentId: 'codex', actorId: p.admin.actor.id, title: null, model: null, effort: null, unread: false, working: false, currentSessionId: created.session.id })
    expect(created.session).toMatchObject({ family: 'codex', cwd: repositoryPaths(p.db).get(alpha.id), actorId: p.admin.actor.id, posture: null })
    expect(created.sessions.map(s => s.sessionId)).toEqual([created.session.id])

    const turnEnd = waitFor(p.sessions, created.session.id, 'turn_end')
    const prompted = await json<ChatThreadPromptResponse>(await call(p, 'POST', threadPromptPath('alpha', created.thread.id), { text: 'hang' }), 202)
    expect(prompted.thread).toMatchObject({ working: true, unread: false, title: 'hang' })
    expect(p.acpHarness.list().map(session => session.cwd)).toEqual([repositoryPaths(p.db).get(alpha.id)])

    const listed = await json<ChatThreadListResponse>(await call(p, 'GET', workspaceThreadsPath('alpha')), 200)
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
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')
    const { thread } = await createThread(p, { agentId: 'codex', title: 'Pinned title' })
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'hang' }), 202)
    const cancelled = await json<ChatThreadPromptResponse>(await call(p, 'POST', threadCancelPath('alpha', thread.id)), 200)
    expect(cancelled.thread).toMatchObject({ working: false, unread: false, title: 'Pinned title' })
  })

  it('launches Claude Code with the chosen model and effort, and starts a new session when they change', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'claude-code', { claudePath: fakeClaude(p.platform.paths.root) })

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
    expect(p.sessions.get(created.session.id)!.cwd).toBe(repositoryPaths(p.db).get(alpha.id))

    const retitled = await json<ChatThreadResponse>(await call(p, 'PATCH', workspaceThreadPath('alpha', created.thread.id), { title: 'Renamed' }), 200)
    expect(retitled.session.id).toBe(created.session.id)

    const switched = await json<ChatThreadResponse>(await call(p, 'PATCH', workspaceThreadPath('alpha', created.thread.id), { model: 'sonnet', effort: null }), 200)
    expect(switched.thread).toMatchObject({ title: 'Renamed', model: 'sonnet', effort: null })
    expect(switched.session.id).not.toBe(created.session.id)
    expect(switched.session.posture).toEqual({ flags: ['--model', 'sonnet'] })
    expect(switched.sessions.map(s => [s.sessionId, s.model, s.effort])).toEqual([[created.session.id, 'opus', 'high'], [switched.session.id, 'sonnet', null]])

    expect(await errorOf(await call(p, 'PATCH', workspaceThreadPath('alpha', created.thread.id), { model: 'gpt-5' }))).toEqual({ status: 400, code: 'invalid_request' })
  })

  it('refuses a model or effort change mid-turn and any Codex choice before a Codex session has run', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')

    const options = await json<ChatAgentOptionsResponse>(await call(p, 'GET', chatAgentOptionsPath('alpha', 'codex')), 200)
    expect(options.options).toEqual({ agentId: 'codex', family: 'codex', models: [], efforts: [] })
    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: 'codex', model: 'gpt-5' }))).toEqual({ status: 400, code: 'invalid_request' })

    const { thread } = await createThread(p, { agentId: 'codex' })
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'hang' }), 202)
    expect(await errorOf(await call(p, 'PATCH', workspaceThreadPath('alpha', thread.id), { effort: 'high' }))).toEqual({ status: 409, code: 'thread_busy' })
    await json(await call(p, 'POST', threadCancelPath('alpha', thread.id)), 200)
  })

  it('validates input and keeps threads per actor', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')
    const dev = developer(p)

    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: 'nobody' }))).toEqual({ status: 404, code: 'not_found' })
    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), {}))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('missing'), { agentId: 'codex' }))).toEqual({ status: 404, code: 'not_found' })

    const { thread } = await createThread(p, { agentId: 'codex' })
    expect(await errorOf(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: '  ' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call(p, 'GET', workspaceThreadPath('alpha', thread.id), undefined, dev))).toEqual({ status: 404, code: 'not_found' })

    const own = await createThread(p, { agentId: 'codex' }, dev)
    expect((await json<ChatThreadListResponse>(await call(p, 'GET', workspaceThreadsPath('alpha'), undefined, dev), 200)).threads.map(t => t.id)).toEqual([own.thread.id])
    expect((await json<ChatThreadListResponse>(await call(p, 'GET', workspaceThreadsPath('alpha', 'codex')), 200)).threads.map(t => t.id)).toEqual([thread.id])
  })

  it('refuses an actor below the chat rung on every route', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'claude-code')
    const { thread } = await createThread(p, { agentId: 'claude-code' })
    const dev = developer(p, { 'chat-claude-code': 'none', 'chat-codex': 'none' })
    const role = dev.actor.roles[0]

    const refused = [
      await call(p, 'GET', workspaceThreadsPath('alpha'), undefined, dev),
      await call(p, 'GET', workspaceThreadsPath('alpha', 'claude-code'), undefined, dev),
      await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: 'claude-code' }, dev),
      await call(p, 'GET', chatAgentOptionsPath('alpha', 'claude-code'), undefined, dev),
    ]
    for (const res of refused) expect(await errorOf(res)).toEqual({ status: 403, code: 'not_granted' })

    // The developer's own thread from before the grant was lowered is refused too.
    await json(await call(p, 'PUT', '/grants', { role, target: { kind: 'module', id: 'agent-hub' }, rungs: {} }), 200)
    const own = await createThread(p, { agentId: 'claude-code' }, dev)
    await json(await call(p, 'PUT', '/grants', { role, target: { kind: 'module', id: 'agent-hub' }, rungs: { 'chat-claude-code': 'none' } }), 200)
    for (const [method, path, body] of [
      ['GET', workspaceThreadPath('alpha', own.thread.id)],
      ['PATCH', workspaceThreadPath('alpha', own.thread.id), { title: 'x' }],
      ['POST', threadReadPath('alpha', own.thread.id)],
      ['POST', threadPromptPath('alpha', own.thread.id), { text: 'hi' }],
      ['POST', threadCancelPath('alpha', own.thread.id)],
    ] as const) {
      expect(await errorOf(await call(p, method, path, body, dev))).toEqual({ status: 403, code: 'not_granted' })
    }
    expect(thread.actorId).toBe(p.admin.actor.id)
  })

  it('refuses chat once the plugin is no longer ready', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')
    const { thread } = await createThread(p, { agentId: 'codex' })
    p.db.update(pluginInstances).set({ health: { healthy: false, reason: 'logged out' } }).run()
    expect(await errorOf(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'hi' }))).toEqual({ status: 409, code: 'not_ready' })
  })
})

describe('Codex models and reasoning effort', () => {
  const optionsOf = async (p: AcpKit) => (await json<ChatAgentOptionsResponse>(await call(p, 'GET', chatAgentOptionsPath('alpha', 'codex')), 200)).options
  const patch = (p: AcpKit, id: string, body: unknown) => call(p, 'PATCH', workspaceThreadPath('alpha', id), body)
  async function turn(p: AcpKit, thread: ChatThreadResponse, text: string): Promise<string[]> {
    const ended = waitFor(p.sessions, thread.session.id, 'turn_end')
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.thread.id), { text }), 202)
    await ended
    return p.sessions.events(thread.session.id).flatMap(e => (e.kind === 'text' ? [e.text] : []))
  }

  it('offers what Codex listed once a session ran and launches a new session with the chosen model and effort', async () => {
    const p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')
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
    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: 'codex', model: 'gpt-fast', effort: 'xhigh' }))).toEqual({ status: 400, code: 'invalid_request' })
    const created = await createThread(p, { agentId: 'codex', model: 'gpt-fast', effort: 'low' })
    expect(created.session.posture).toEqual({ codex: { model: 'gpt-fast', reasoningEffort: 'low' } })
    expect(await turn(p, created, 'model')).toEqual(['model:gpt-fast/low'])
  })

  it('keeps a thread\'s accepted model after a restart empties the list, and offers nothing while Codex is not logged in', async () => {
    let p = boot()
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')
    const first = await createThread(p, { agentId: 'codex' })
    await turn(p, first, 'hello')
    const deep = await json<ChatThreadResponse>(await patch(p, first.thread.id, { model: 'gpt-deep' }), 200)

    await p.sessions.close()
    p = kit = await p.restart({ acp: { bins: { ...fakeBins, codexAdapter: { command: 'env', args: ['FAKE_ACP_AUTH=none', process.execPath, FAKE_ACP_AGENT] } }, killTimeoutMs: 1000 } })
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
    const alpha = await workspace(p)
    healthyPlugin(p, alpha, 'codex')
    const { thread, session } = await createThread(p, { agentId: 'codex' })
    await json(await call(p, 'POST', threadPromptPath('alpha', thread.id), { text: 'hang' }), 202)
    await p.sessions.close()

    p = kit = await p.restart()
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

describe('the threads definition under the ACP manager', () => {
  let checkout: string | undefined
  let started: TestKit | undefined

  afterEach(async () => {
    await started?.close()
    started = undefined
    if (checkout) rmSync(checkout, { recursive: true, force: true })
    checkout = undefined
    vi.restoreAllMocks()
  })

  function start() {
    started = testKit({ product: acpTestProduct({ acp: { bins: fakeBins, killTimeoutMs: 1000 } }) })
    return started.platform
  }

  it('closes after the ACP manager that writes through it, and its signal ends with the platform', async () => {
    const platform = start()
    const store = platform.runtime.service(THREAD_SESSIONS)!
    const sessions = platform.runtime.service(ACP_SESSIONS)!
    const order: string[] = []
    const record = <T extends object, K extends keyof T & string>(target: T, method: K, name: string) => {
      const original = (target[method] as unknown as (...args: unknown[]) => unknown).bind(target)
      vi.spyOn(target, method as never).mockImplementation(((...args: unknown[]) => {
        order.push(name)
        return original(...args)
      }) as never)
    }
    record(sessions, 'close', 'manager')
    record(store, 'close', 'store')

    expect(store.signal.aborted).toBe(false)
    await platform.close()
    expect(order).toEqual(['manager', 'store'])
    expect(store.signal.aborted).toBe(true)
    expect(sessions.signal.aborted).toBe(true)
  })
})
