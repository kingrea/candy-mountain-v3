import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chatAgentOptionsPath, workspaceRegistryPath, workspaceThreadPath, workspaceThreadsPath, sessionPromptPath, threadClosePath, threadPromptPath, type AgentSessionEvent, type AgentSessionEventKind, type ApiErrorBody, type ChatAgentOptionsResponse, type ChatThreadCloseResponse, type ChatThreadListResponse, type ChatThreadPromptResponse, type ChatThreadResponse, type RegistryResponse } from '@candy-mountain/platform-sdk'
import { botAgentId, botSessionsPath, type BotFamily, type BotSessionStartResponse, chatThreadBot } from '../wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins, fakeClaude, type SessionManager, type SessionMessage } from '@candy-mountain/cap-acp'
import type { TestActor } from '@candy-mountain/platform-daemon/testing'
import { createBot, getBot, parseCreateBot, recordBotPersonaCheck } from '../bots'
import { GOOD_TOKEN, stubHosts } from '../test-support'
import { botsKit, restartBots, type BotsKit } from '../test-support'
import { createTempGitRepo, type TempGitRepo } from '../worktrees/test-repo'
import { setRepository } from '@candy-mountain/plugin-repository'

const CLAUDE_PERSONA = '---\nname: ana\ndescription: Ana fixes small issues.\n---\nYou are Ana. Keep changes small.\n'

let kit: BotsKit | undefined
let repo: TempGitRepo | undefined

afterEach(async () => {
  await kit?.close()
  kit = undefined
  repo?.cleanup()
  repo = undefined
  vi.unstubAllGlobals()
})

function call(p: BotsKit, method: string, path: string, body?: unknown, actor: TestActor = p.admin) {
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

function commitFile(path: string, text: string): void {
  const file = join(repo!.clone, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  repo!.git(repo!.clone, 'add', path)
  repo!.git(repo!.clone, 'commit', '--quiet', '-m', `add ${path}`)
  repo!.git(repo!.clone, 'push', '--quiet', 'origin', 'main')
}


/** Workspace `alpha` on a temp clone with a bare origin and persona `ana` on main; Repository and Claude Code stored healthy; one bot without Slack keys. */
async function setup({ family = 'claude-code', verified = true }: { family?: BotFamily, verified?: boolean } = {}) {
  repo = createTempGitRepo()
  commitFile('.claude/agents/ana.md', CLAUDE_PERSONA)
  stubHosts()
  const p = kit = botsKit({ acp: { bins: fakeBins, killTimeoutMs: 1000 } })
  const workspace = p.workspace({ name: 'alpha', slug: 'alpha', modules: ['agent-hub'] })
  await setRepository(p.db, workspace.id, { kind: 'local-path', path: repo.clone })
  p.pluginInstance({ type: 'repository', workspace, config: { host: 'github', owner: 'jack', repo: 'candy' }, secrets: { token: GOOD_TOKEN } })
  p.pluginInstance({ type: 'claude-code', workspace, config: { claudePath: fakeClaude(p.platform.paths.root) } })
  const bot = await createBot(p.deps, workspace.id, parseCreateBot({ name: 'Ana Bot', family, writeScope: 'write-confirm', personaName: 'ana' }))
  if (verified) expect(recordBotPersonaCheck(p.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(true)
  return { p, workspace, bot }
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

async function until(read: () => Promise<boolean> | boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await read())) {
    if (Date.now() > deadline) throw new Error('Condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function textOf(p: BotsKit, sessionId: string, match: string): string {
  const event = p.sessions.events(sessionId).find(e => e.kind === 'text' && e.text.includes(match))
  return event?.kind === 'text' ? event.text : ''
}

const agentsOf = async (p: BotsKit, actor: TestActor = p.admin) => (await json<RegistryResponse>(await call(p, 'GET', workspaceRegistryPath('alpha'), undefined, actor), 200)).agents
const getThread = async (p: BotsKit, id: string) => json<ChatThreadResponse>(await call(p, 'GET', workspaceThreadPath('alpha', id)), 200)
const listThreads = async (p: BotsKit) => (await json<ChatThreadListResponse>(await call(p, 'GET', workspaceThreadsPath('alpha')), 200)).threads

async function prompt(p: BotsKit, threadId: string, text: string): Promise<ChatThreadPromptResponse> {
  return json<ChatThreadPromptResponse>(await call(p, 'POST', threadPromptPath('alpha', threadId), { text }), 202)
}

async function promptAndWait(p: BotsKit, threadId: string, text: string): Promise<ChatThreadPromptResponse> {
  const { session } = await getThread(p, threadId)
  const turnEnd = waitFor(p.sessions, session.id, 'turn_end')
  const response = await prompt(p, threadId, text)
  await turnEnd
  return response
}

describe('bots as chat agents', () => {
  it('lists a bot whose only gaps are its Slack keys, as a bot agent of the workspace', async () => {
    const { p, bot } = await setup()
    expect((await getBot(p.deps, bot.id)).status).toEqual({ warnings: ['Slack bot token is missing', 'Slack app-level token is missing'] })
    expect(await agentsOf(p)).toContainEqual({
      id: botAgentId(bot.id),
      capabilityId: 'bots',
      label: 'Ana Bot',
      description: 'Claude Code bot, write (confirmation prompts), working in its own worktree.',
      family: 'claude-code',
      avatar: 'i-lucide-bot',
      kind: 'workspace',
      extension: { id: bot.id, writeScope: 'write-confirm', baseBranch: null },
    })
  })

  it('leaves out a bot that is not usable yet, and actors without chat on bots or on the bot\'s family', async () => {
    const { p, workspace } = await setup({ verified: false })
    expect((await agentsOf(p)).map(agent => agent.id)).toEqual(['claude-code'])

    const ready = await createBot(p.deps, workspace.id, parseCreateBot({ name: 'Ready Bot', family: 'claude-code', personaName: 'ana' }))
    recordBotPersonaCheck(p.db, ready.id, ready.updatedAt, { status: 'verified' })
    expect((await agentsOf(p)).map(agent => agent.id)).toEqual(['claude-code', botAgentId(ready.id)])

    const developer = p.actor({ rungs: { 'bots': 'manage', 'chat-claude-code': 'chat' } })
    expect((await agentsOf(p, developer)).map(agent => agent.id)).toEqual(['claude-code', botAgentId(ready.id)])
    const withoutBots = p.actor({ rungs: { 'bots': 'none', 'chat-claude-code': 'chat' } })
    expect((await agentsOf(p, withoutBots)).map(agent => agent.id)).toEqual(['claude-code'])
    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: botAgentId(ready.id) }, withoutBots))).toEqual({ status: 403, code: 'not_granted' })
    const withoutFamily = p.actor({ rungs: { 'bots': 'manage', 'chat-claude-code': 'none' } })
    expect((await agentsOf(p, withoutFamily)).map(agent => agent.id)).toEqual([])
    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: botAgentId(ready.id) }, withoutFamily))).toEqual({ status: 403, code: 'not_granted' })

    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: 'bot:nobody' }))).toEqual({ status: 404, code: 'not_found' })
  })
})

describe('bot threads', () => {
  it('runs the bot in its own worktree, keeps an unpushed worktree on close and releases it once pushed, while a plain thread uses the checkout', async () => {
    const { p, bot } = await setup()
    const agentId = botAgentId(bot.id)
    const statusBefore = repo!.git(repo!.clone, 'status', '--porcelain')

    expect(await errorOf(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId, model: 'opus' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect((await json<ChatAgentOptionsResponse>(await call(p, 'GET', chatAgentOptionsPath('alpha', agentId)), 200)).options).toEqual({ agentId, family: 'claude-code', models: [], efforts: [] })

    const created = await json<ChatThreadResponse>(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId }), 201)
    const { thread, session } = created
    const info = chatThreadBot(created)
    expect(thread).toMatchObject({ agentId, actorId: p.admin.actor.id, title: null, working: false })
    expect(info).toMatchObject({ botId: bot.id, name: 'Ana Bot', branch: `cm/bot/ana-bot/${session.id}`, baseBranch: 'main', worktree: 'active', keptUnpushed: false })
    expect(info!.worktreePath!.startsWith(p.platform.paths.worktrees)).toBe(true)
    expect(session).toMatchObject({ family: 'claude-code', cwd: info!.worktreePath, actorId: p.admin.actor.id })
    expect(session.posture?.bot).toEqual({ id: bot.id, name: 'Ana Bot', holder: { kind: 'console', id: thread.id } })
    // Write with confirmation: every edit and every push goes through a permission decision.
    const flags = session.posture!.flags!
    expect(flags.slice(0, 2)).toEqual(['--permission-mode', 'default'])
    expect(flags.join(' ')).not.toContain('git push')
    expect(repo!.git(info!.worktreePath!, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(info!.branch)

    const first = await promptAndWait(p, thread.id, 'launch-env')
    expect(first.thread.title).toBe('launch-env')
    const launched = JSON.parse(textOf(p, session.id, '"args"')) as { args: string[] }
    expect(launched.args).toEqual(expect.arrayContaining(['--permission-mode', 'default', '--agent', 'ana']))
    await until(async () => (await listThreads(p)).find(t => t.id === thread.id)?.unread === true)

    const decision = waitFor(p.sessions, session.id, 'decision_opened')
    await prompt(p, thread.id, 'permission')
    await decision
    expect((await listThreads(p)).find(t => t.id === thread.id)?.working).toBe(true)
    const pending = p.decisions.list(session.id).find(d => d.state === 'pending')!
    p.decisions.answer(pending.id, { optionKind: 'deny', surface: 'web', actorId: p.admin.actor.id })
    await until(async () => (await listThreads(p)).find(t => t.id === thread.id)?.working === false)

    const plain = await json<ChatThreadResponse>(await call(p, 'POST', workspaceThreadsPath('alpha'), { agentId: 'claude-code' }), 201)
    expect(plain.session.cwd).toBe(repo!.clone)
    expect(plain.extension).toBeUndefined()
    expect(await errorOf(await call(p, 'POST', threadClosePath('alpha', plain.thread.id)))).toEqual({ status: 422, code: 'unsupported_agent' })

    const worktree = info!.worktreePath!
    writeFileSync(join(worktree, 'fix.txt'), 'fixed\n')
    const kept = await json<ChatThreadCloseResponse>(await call(p, 'POST', threadClosePath('alpha', thread.id)), 200)
    expect(kept).toMatchObject({ released: false, extension: { worktree: 'active', keptUnpushed: true, unpushedReason: expect.stringContaining('uncommitted') } })
    expect(existsSync(join(worktree, 'fix.txt'))).toBe(true)

    repo!.git(worktree, 'add', 'fix.txt')
    repo!.git(worktree, 'commit', '--quiet', '-m', 'fix')
    const notPushed = await json<ChatThreadCloseResponse>(await call(p, 'POST', threadClosePath('alpha', thread.id)), 200)
    expect(notPushed).toMatchObject({ released: false, extension: { keptUnpushed: true, unpushedReason: expect.stringContaining('not on origin') } })

    repo!.git(worktree, 'push', '--quiet', 'origin', info!.branch!)
    const released = await json<ChatThreadCloseResponse>(await call(p, 'POST', threadClosePath('alpha', thread.id)), 200)
    expect(released).toMatchObject({ released: true, extension: { worktree: 'released', branch: info!.branch, worktreePath: worktree, keptUnpushed: false } })
    expect(existsSync(worktree)).toBe(false)
    expect(chatThreadBot(await getThread(p, thread.id))).toMatchObject({ worktree: 'released' })
    expect(repo!.git(repo!.clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(repo!.git(repo!.clone, 'status', '--porcelain')).toBe(statusBefore)

    // The next prompt on a closed thread starts a fresh session in a fresh worktree on the same thread.
    const again = await prompt(p, thread.id, 'hello again')
    expect(again.session.id).not.toBe(session.id)
    expect(again.thread.currentSessionId).toBe(again.session.id)
    const reopened = await getThread(p, thread.id)
    expect(reopened.sessions.map(s => s.sessionId)).toEqual([session.id, again.session.id])
    const reopenedBot = chatThreadBot(reopened)
    expect(reopenedBot).toMatchObject({ worktree: 'active' })
    expect(reopenedBot!.worktreePath).not.toBe(worktree)
    expect(reopened.session.cwd).toBe(reopenedBot!.worktreePath)
  }, 120_000)

  it('adopts bot threads started outside the thread routes, and after a restart', async () => {
    const { p: first, bot } = await setup()
    const started = await json<BotSessionStartResponse>(await call(first, 'POST', botSessionsPath('alpha', bot.id), { threadId: 'outside-thread' }), 201)
    const detail = await getThread(first, 'outside-thread')
    expect(chatThreadBot(detail)).toMatchObject({ worktreePath: started.lease.path, branch: started.lease.branch, worktree: 'active' })

    const turnEnd = waitFor(first.sessions, started.session.id, 'turn_end')
    await json(await call(first, 'POST', sessionPromptPath('alpha', started.session.id), { text: 'hello' }), 202)
    await turnEnd
    await until(async () => (await listThreads(first)).find(t => t.id === 'outside-thread')?.unread === true)

    const p = kit = await restartBots(first)
    const after = await getThread(p, 'outside-thread')
    expect(after).toMatchObject({ thread: { working: false }, session: { id: started.session.id, status: 'idle' }, extension: { worktreePath: started.lease.path, worktree: 'active' } })
    const reply = await promptAndWait(p, 'outside-thread', 'after restart')
    expect(reply.session.id).toBe(started.session.id)
    expect(p.sessions.events(started.session.id).some(e => e.kind === 'text' && e.text === 'after restart' && e.role === 'agent')).toBe(true)
    await until(async () => (await listThreads(p)).find(t => t.id === 'outside-thread')?.unread === true)
  }, 120_000)
})
