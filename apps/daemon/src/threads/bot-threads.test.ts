import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { botAgentId, botSessionsPath, chatAgentOptionsPath, projectRegistryPath, projectThreadPath, projectThreadsPath, sessionPromptPath, threadClosePath, threadPromptPath, type Actor, type AgentSessionEvent, type AgentSessionEventKind, type ApiErrorBody, type BotFamily, type BotSessionStartResponse, type ChatAgentOptionsResponse, type ChatThreadCloseResponse, type ChatThreadListResponse, type ChatThreadPromptResponse, type ChatThreadResponse, type PluginTypeId, type RegistryResponse } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins, fakeClaude } from '../acp/test-support'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { createBot, getBot, parseCreateBot, recordBotPersonaCheck, type BotReadDeps } from '../bots'
import { pluginInstances } from '../db/schema'
import { addRole } from '../grants/test-access'
import { createPluginInstance } from '../plugins/instances/instances'
import { GOOD_TOKEN, stubHosts } from '../plugins/repository/fake-hosts'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject, sourcePath } from '../projects/projects'
import { startPlatform, type Platform } from '../platform'
import { MasterKey } from '../secrets'
import type { SessionManager, SessionMessage } from '../sessions'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createTempGitRepo, type TempGitRepo } from '../worktrees/test-repo'

const ADMIN: Actor = { id: 'admin-actor', username: 'admin', displayName: 'Admin', roles: ['admin'] }
const DEVELOPER: Actor = { id: 'dev-actor', username: 'dev', displayName: 'Dev', roles: ['developer'] }
const CLAUDE_PERSONA = '---\nname: ana\ndescription: Ana fixes small issues.\n---\nYou are Ana. Keep changes small.\n'

let temp: TempDataDir | undefined
let platform: Platform | undefined
let repo: TempGitRepo | undefined

afterEach(async () => {
  await platform?.sessions.close()
  platform?.close()
  platform = undefined
  temp?.cleanup()
  temp = undefined
  repo?.cleanup()
  repo = undefined
  vi.unstubAllGlobals()
})

const as = (actor: Actor): AuthStrategy => ({ name: 'development', resolve: () => actor })

function call(p: Platform, method: string, path: string, body?: unknown, actor: Actor = ADMIN) {
  const app = createApp({ db: p.db, paths: p.paths, auth: as(actor), pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets, sessions: p.sessions, decisions: p.decisions, botSessions: p.botSessions })
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

function commitFile(path: string, text: string): void {
  const file = join(repo!.clone, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  repo!.git(repo!.clone, 'add', path)
  repo!.git(repo!.clone, 'commit', '--quiet', '-m', `add ${path}`)
  repo!.git(repo!.clone, 'push', '--quiet', 'origin', 'main')
}

function setHealth(p: Platform, projectId: string, type: PluginTypeId, config: Record<string, unknown> = {}, secrets: Record<string, string> = {}): void {
  const existing = p.db.select().from(pluginInstances).where(eq(pluginInstances.projectId, projectId)).all().find(row => row.typeId === type)
  const id = existing?.id ?? createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type, scope: 'project', projectId, config, secrets }).id
  p.db.update(pluginInstances).set({ health: { healthy: true }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, id)).run()
}

const readDeps = (p: Platform): BotReadDeps => ({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets })

function boot(dataDir: string, key: MasterKey): Platform {
  platform = startPlatform(dataDir, { secretsKey: key, acp: { bins: fakeBins, killTimeoutMs: 1000 } })
  return platform
}

/** Project `alpha` on a temp clone with a bare origin and persona `ana` on main; Repository and Claude Code stored healthy; one bot without Slack keys. */
async function setup({ family = 'claude-code', verified = true }: { family?: BotFamily, verified?: boolean } = {}) {
  repo = createTempGitRepo()
  commitFile('.claude/agents/ana.md', CLAUDE_PERSONA)
  stubHosts()
  temp = createTempDataDir()
  const key = MasterKey.generate()
  const p = boot(temp.root, key)
  const project = await createProject(p.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: repo.clone } })
  setEnabledModules(p.db, project.id, ['agent-hub'])
  setHealth(p, project.id, 'repository', { host: 'github', owner: 'jack', repo: 'candy' }, { token: GOOD_TOKEN })
  setHealth(p, project.id, 'claude-code', { claudePath: fakeClaude(temp.root) })
  const bot = await createBot(readDeps(p), project.id, parseCreateBot({ name: 'Ana Bot', family, writeScope: 'write-confirm', personaName: 'ana' }))
  if (verified) expect(recordBotPersonaCheck(p.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(true)
  return { p, project, bot, key }
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

function textOf(p: Platform, sessionId: string, match: string): string {
  const event = p.sessions.events(sessionId).find(e => e.kind === 'text' && e.text.includes(match))
  return event?.kind === 'text' ? event.text : ''
}

const agentsOf = async (p: Platform, actor: Actor = ADMIN) => (await json<RegistryResponse>(await call(p, 'GET', projectRegistryPath('alpha'), undefined, actor), 200)).agents
const getThread = async (p: Platform, id: string) => json<ChatThreadResponse>(await call(p, 'GET', projectThreadPath('alpha', id)), 200)
const listThreads = async (p: Platform) => (await json<ChatThreadListResponse>(await call(p, 'GET', projectThreadsPath('alpha')), 200)).threads

async function prompt(p: Platform, threadId: string, text: string): Promise<ChatThreadPromptResponse> {
  return json<ChatThreadPromptResponse>(await call(p, 'POST', threadPromptPath('alpha', threadId), { text }), 202)
}

async function promptAndWait(p: Platform, threadId: string, text: string): Promise<ChatThreadPromptResponse> {
  const { session } = await getThread(p, threadId)
  const turnEnd = waitFor(p.sessions, session.id, 'turn_end')
  const response = await prompt(p, threadId, text)
  await turnEnd
  return response
}

describe('bots as chat agents', () => {
  it('lists a bot whose only gaps are its Slack keys, as a bot agent of the project', async () => {
    const { p, bot } = await setup()
    expect((await getBot(readDeps(p), bot.id)).status).toEqual({ warnings: ['Slack bot token is missing', 'Slack app-level token is missing'] })
    expect(await agentsOf(p)).toContainEqual({
      id: botAgentId(bot.id),
      capabilityId: 'bots',
      label: 'Ana Bot',
      description: 'Claude Code bot, write (confirmation prompts), working in its own worktree.',
      family: 'claude-code',
      avatar: 'i-lucide-bot',
      kind: 'bot',
      bot: { id: bot.id, writeScope: 'write-confirm', baseBranch: null },
    })
  })

  it('leaves out a bot that is not usable yet, and actors without chat on bots or on the bot\'s family', async () => {
    const { p, project } = await setup({ verified: false })
    expect((await agentsOf(p)).map(agent => agent.id)).toEqual(['claude-code'])

    const ready = await createBot(readDeps(p), project.id, parseCreateBot({ name: 'Ready Bot', family: 'claude-code', personaName: 'ana' }))
    recordBotPersonaCheck(p.db, ready.id, ready.updatedAt, { status: 'verified' })
    expect((await agentsOf(p)).map(agent => agent.id)).toEqual(['claude-code', botAgentId(ready.id)])

    addRole(p.db, 'developer')
    await json(await call(p, 'PUT', '/grants', { role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs: {} }), 200)
    expect((await agentsOf(p, DEVELOPER)).map(agent => agent.id)).toEqual(['claude-code', botAgentId(ready.id)])
    await json(await call(p, 'PUT', '/grants', { role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs: { bots: 'none' } }), 200)
    expect((await agentsOf(p, DEVELOPER)).map(agent => agent.id)).toEqual(['claude-code'])
    expect(await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), { agentId: botAgentId(ready.id) }, DEVELOPER))).toEqual({ status: 403, code: 'not_granted' })
    await json(await call(p, 'PUT', '/grants', { role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs: { 'chat-claude-code': 'none' } }), 200)
    expect((await agentsOf(p, DEVELOPER)).map(agent => agent.id)).toEqual([])
    expect(await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), { agentId: botAgentId(ready.id) }, DEVELOPER))).toEqual({ status: 403, code: 'not_granted' })

    expect(await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), { agentId: 'bot:nobody' }))).toEqual({ status: 404, code: 'not_found' })
  })
})

describe('bot threads', () => {
  it('runs the bot in its own worktree, keeps an unpushed worktree on close and releases it once pushed, while a plain thread uses the checkout', async () => {
    const { p, project, bot } = await setup()
    const agentId = botAgentId(bot.id)
    const statusBefore = repo!.git(repo!.clone, 'status', '--porcelain')

    expect(await errorOf(await call(p, 'POST', projectThreadsPath('alpha'), { agentId, model: 'opus' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect((await json<ChatAgentOptionsResponse>(await call(p, 'GET', chatAgentOptionsPath('alpha', agentId)), 200)).options).toEqual({ agentId, family: 'claude-code', models: [], efforts: [] })

    const created = await json<ChatThreadResponse>(await call(p, 'POST', projectThreadsPath('alpha'), { agentId }), 201)
    const { thread, session, bot: info } = created
    expect(thread).toMatchObject({ agentId, actorId: ADMIN.id, title: null, working: false })
    expect(info).toMatchObject({ botId: bot.id, name: 'Ana Bot', branch: `cm/bot/ana-bot/${session.id}`, baseBranch: 'main', worktree: 'active', keptUnpushed: false })
    expect(info!.worktreePath!.startsWith(p.paths.worktrees)).toBe(true)
    expect(session).toMatchObject({ family: 'claude-code', cwd: info!.worktreePath, actorId: ADMIN.id })
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
    p.decisions.answer(pending.id, { optionKind: 'deny', surface: 'web', actorId: ADMIN.id })
    await until(async () => (await listThreads(p)).find(t => t.id === thread.id)?.working === false)

    const plain = await json<ChatThreadResponse>(await call(p, 'POST', projectThreadsPath('alpha'), { agentId: 'claude-code' }), 201)
    expect(plain.session.cwd).toBe(sourcePath(project.source))
    expect(plain.bot).toBeUndefined()
    expect(await errorOf(await call(p, 'POST', threadClosePath('alpha', plain.thread.id)))).toEqual({ status: 422, code: 'unsupported_agent' })

    const worktree = info!.worktreePath!
    writeFileSync(join(worktree, 'fix.txt'), 'fixed\n')
    const kept = await json<ChatThreadCloseResponse>(await call(p, 'POST', threadClosePath('alpha', thread.id)), 200)
    expect(kept).toMatchObject({ released: false, keptUnpushed: true, bot: { worktree: 'active', keptUnpushed: true, unpushedReason: expect.stringContaining('uncommitted') } })
    expect(existsSync(join(worktree, 'fix.txt'))).toBe(true)

    repo!.git(worktree, 'add', 'fix.txt')
    repo!.git(worktree, 'commit', '--quiet', '-m', 'fix')
    const notPushed = await json<ChatThreadCloseResponse>(await call(p, 'POST', threadClosePath('alpha', thread.id)), 200)
    expect(notPushed).toMatchObject({ released: false, keptUnpushed: true, bot: { unpushedReason: expect.stringContaining('not on origin') } })

    repo!.git(worktree, 'push', '--quiet', 'origin', info!.branch!)
    const released = await json<ChatThreadCloseResponse>(await call(p, 'POST', threadClosePath('alpha', thread.id)), 200)
    expect(released).toMatchObject({ released: true, keptUnpushed: false, bot: { worktree: 'released', branch: info!.branch, worktreePath: worktree, keptUnpushed: false } })
    expect(existsSync(worktree)).toBe(false)
    expect((await getThread(p, thread.id)).bot).toMatchObject({ worktree: 'released' })
    expect(repo!.git(repo!.clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(repo!.git(repo!.clone, 'status', '--porcelain')).toBe(statusBefore)

    // The next prompt on a closed thread starts a fresh session in a fresh worktree on the same thread.
    const again = await prompt(p, thread.id, 'hello again')
    expect(again.session.id).not.toBe(session.id)
    expect(again.thread.currentSessionId).toBe(again.session.id)
    const reopened = await getThread(p, thread.id)
    expect(reopened.sessions.map(s => s.sessionId)).toEqual([session.id, again.session.id])
    expect(reopened.bot).toMatchObject({ worktree: 'active' })
    expect(reopened.bot!.worktreePath).not.toBe(worktree)
    expect(reopened.session.cwd).toBe(reopened.bot!.worktreePath)
  }, 120_000)

  it('adopts bot threads started outside the thread routes, and after a restart', async () => {
    const { p: first, bot, key } = await setup()
    const started = await json<BotSessionStartResponse>(await call(first, 'POST', botSessionsPath('alpha', bot.id), { threadId: 'outside-thread' }), 201)
    const detail = await getThread(first, 'outside-thread')
    expect(detail.bot).toMatchObject({ worktreePath: started.lease.path, branch: started.lease.branch, worktree: 'active' })

    const turnEnd = waitFor(first.sessions, started.session.id, 'turn_end')
    await json(await call(first, 'POST', sessionPromptPath('alpha', started.session.id), { text: 'hello' }), 202)
    await turnEnd
    await until(async () => (await listThreads(first)).find(t => t.id === 'outside-thread')?.unread === true)

    await first.sessions.close()
    first.close()
    const p = boot(temp!.root, key)
    const after = await getThread(p, 'outside-thread')
    expect(after).toMatchObject({ thread: { working: false }, session: { id: started.session.id, status: 'idle' }, bot: { worktreePath: started.lease.path, worktree: 'active' } })
    const reply = await promptAndWait(p, 'outside-thread', 'after restart')
    expect(reply.session.id).toBe(started.session.id)
    expect(p.sessions.events(started.session.id).some(e => e.kind === 'text' && e.text === 'after restart' && e.role === 'agent')).toBe(true)
    await until(async () => (await listThreads(p)).find(t => t.id === 'outside-thread')?.unread === true)
  }, 120_000)
})
