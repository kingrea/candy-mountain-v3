import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { botAgentId, botSessionClosePath, botSessionsPath, sessionPromptPath, type Actor, type AgentSessionEvent, type AgentSessionEventKind, type ApiErrorBody, type BotFamily, type BotSessionCloseResponse, type BotSessionStartResponse, type BotWriteScope, type PluginTypeId } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins, fakeClaude } from '../acp/test-support'
import { listActivityEvents } from '../activity'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { createBot, parseCreateBot, type BotReadDeps } from '../bots'
import { pluginInstances } from '../db/schema'
import { hasBd } from '../issues/test-workspace'
import { createPluginInstance } from '../plugins/instances/instances'
import { GOOD_TOKEN, json as hostJson, stubHosts } from '../plugins/repository/fake-hosts'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject } from '../projects/projects'
import { startPlatform, type Platform, type PlatformOptions } from '../platform'
import { MasterKey } from '../secrets'
import type { SessionManager, SessionMessage } from '../sessions'
import { createTempDataDir, type TempDataDir } from '../testing'
import { findThread } from '../threads/store'
import { createTempGitRepo, TEST_GIT_ENV, type TempGitRepo } from '../worktrees/test-repo'

const ADMIN: Actor = { id: 'admin-actor', username: 'admin', displayName: 'Admin', roles: ['admin'] }
const CLAUDE_PERSONA = '---\nname: ana\ndescription: Ana fixes small issues.\n---\nYou are Ana. Keep changes small.\n'
const CODEX_PERSONA = 'You are Cody. Keep changes small.\n'

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

interface BdIssue { id: string, title: string }

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...TEST_GIT_ENV, BD_NON_INTERACTIVE: '1', ...extra }
  if (!('BEADS_DIR' in extra)) delete env.BEADS_DIR
  delete env.BEADS_DB
  return env
}

function bd(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): unknown {
  return JSON.parse(execFileSync('bd', [...args, '--json'], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as unknown
}

function commitFile(path: string, text: string): void {
  const file = join(repo!.clone, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  repo!.git(repo!.clone, 'add', path)
  repo!.git(repo!.clone, 'commit', '--quiet', '-m', `add ${path}`)
  repo!.git(repo!.clone, 'push', '--quiet', 'origin', 'main')
}

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
  const body = (await res.json()) as ApiErrorBody
  return { status: res.status, code: body.error.code, message: body.error.message }
}

const readDeps = (p: Platform): BotReadDeps => ({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets })

/** Stands in for a passing connection test: the starter only reads the stored result. */
function setHealth(p: Platform, projectId: string, type: PluginTypeId, healthy: boolean, config: Record<string, unknown> = {}): void {
  const existing = p.db.select().from(pluginInstances).where(eq(pluginInstances.projectId, projectId)).all().find(row => row.typeId === type)
  const id = existing?.id ?? createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type, scope: 'project', projectId, config, secrets: {} }).id
  p.db.update(pluginInstances).set({ health: healthy ? { healthy: true } : { healthy: false, reason: 'Not logged in.' }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, id)).run()
}

interface SetupOptions {
  family?: BotFamily
  writeScope?: BotWriteScope
  personaName?: string
  /** `bd` runs `bd init --stealth` in the clone; `dir` only creates `.beads` so the env is produced without bd. */
  beads?: 'bd' | 'dir' | false
  worktrees?: PlatformOptions['worktrees']
}

/** Project `alpha` on a temp clone with a bare origin, personas `ana` (Claude) and `cody` (Codex) on main, both agent plugins stored healthy. */
async function setup({ family = 'claude-code', writeScope = 'write-confirm', personaName = 'ana', beads = false, worktrees }: SetupOptions = {}) {
  repo = createTempGitRepo()
  commitFile('.claude/agents/ana.md', CLAUDE_PERSONA)
  commitFile('.agents/cody.md', CODEX_PERSONA)
  if (beads === 'bd') execFileSync('bd', ['init', '--non-interactive', '--prefix', 'wt', '--skip-agents', '--quiet', '--stealth'], { cwd: repo.clone, env: cleanEnv(), stdio: 'ignore' })
  if (beads === 'dir') mkdirSync(join(repo.clone, '.beads'))
  // The stub host knows .claude/agents/ana.md; the Codex persona is answered here so `cody` checks out as present too.
  stubHosts(request => (decodeURIComponent(request.url.pathname) === '/repos/jack/candy/contents/.agents/cody.md' ? hostJson(200, { type: 'file', path: '.agents/cody.md' }) : undefined))

  temp = createTempDataDir()
  const p = startPlatform(temp.root, { secretsKey: MasterKey.generate(), acp: { bins: fakeBins, killTimeoutMs: 1000 }, worktrees })
  platform = p
  const project = await createProject(p.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: repo.clone } })
  // The session routes the console prompts through are gated on the chat capabilities of the Agent Hub module.
  setEnabledModules(p.db, project.id, ['agent-hub'])
  createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type: 'repository', scope: 'project', projectId: project.id, config: { host: 'github', owner: 'jack', repo: 'candy' }, secrets: { token: GOOD_TOKEN } })
  setHealth(p, project.id, 'claude-code', true, { claudePath: fakeClaude(temp.root) })
  setHealth(p, project.id, 'codex', true)
  const bot = await createBot(readDeps(p), project.id, parseCreateBot({ name: 'Ana Bot', family, writeScope, personaName }))
  return { p, project, bot }
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

async function until(read: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!read()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const start = (p: Platform, botId: string, threadId?: string) => call(p, 'POST', botSessionsPath('alpha', botId), threadId ? { threadId } : undefined)

const textOf = (p: Platform, sessionId: string, match: string) => {
  const event = p.sessions.events(sessionId).find(e => e.kind === 'text' && e.text.includes(match))
  return event && event.kind === 'text' ? event.text : undefined
}

describe.skipIf(!hasBd)('bot session end to end', () => {
  it('runs a Claude Code bot in a worktree on a new branch, routes bd to the main checkout, resumes by thread and releases on close', async () => {
    const { p, project, bot } = await setup({ beads: 'bd' })
    const statusBefore = repo!.git(repo!.clone, 'status', '--porcelain')
    const threadId = 'console-thread-1'

    const started = await json<BotSessionStartResponse>(await start(p, bot.id, threadId), 201)
    const { session, lease } = started
    expect(lease.branch).toBe(`cm/bot/ana-bot/${session.id}`)
    expect(lease.path.startsWith(p.paths.worktrees)).toBe(true)
    expect(repo!.git(lease.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(lease.branch)
    expect(repo!.git(lease.path, 'rev-parse', 'HEAD')).toBe(repo!.git(repo!.clone, 'rev-parse', 'origin/main'))
    expect(repo!.git(repo!.clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(lease.dependencies).toMatchObject({ status: 'skipped' })
    expect(started.warnings).toEqual([])
    expect(started.resumed).toBe(false)

    expect(session).toMatchObject({ family: 'claude-code', cwd: lease.path, actorId: ADMIN.id, status: 'idle' })
    expect(session.posture?.bot).toEqual({ id: bot.id, name: 'Ana Bot', holder: { kind: 'console', id: threadId } })
    expect(session.posture?.env).toEqual({ BEADS_DIR: join(repo!.clone, '.beads'), BD_NON_INTERACTIVE: '1' })
    const flags = session.posture!.flags!
    expect(flags.slice(0, 2)).toEqual(['--permission-mode', 'default'])
    expect(flags).toEqual(expect.arrayContaining(['--agent', 'ana', '--strict-mcp-config', '--allowedTools', 'Bash(bd *)', '--disallowedTools', 'Agent,Workflow']))
    const instructions = flags[flags.indexOf('--append-system-prompt') + 1]!
    expect(instructions).toContain('# Platform instructions')
    expect(instructions).toContain(`branch \`${lease.branch}\`, cut from \`main\``)
    expect(instructions).toContain('Issues are tracked with `bd`')
    expect(instructions).toContain('jack/candy on GitHub')
    expect(instructions).not.toContain('post_blocks')

    expect(started.thread).toMatchObject({ id: threadId, projectId: project.id, actorId: ADMIN.id, agentId: botAgentId(bot.id), currentSessionId: session.id, title: 'Ana Bot', working: false })
    expect(listActivityEvents(p.db, project.id).events[0]).toMatchObject({ type: 'session.started', title: 'Bot "Ana Bot" session started', payload: { sessionId: session.id, family: 'claude-code', actorId: ADMIN.id, botId: bot.id, botName: 'Ana Bot' } })

    const usedBefore = p.worktrees.get(lease.id)!.lastUsedAt
    await new Promise(resolve => setTimeout(resolve, 5))
    const turnEnd = waitFor(p.sessions, session.id, 'turn_end')
    await json(await call(p, 'POST', sessionPromptPath('alpha', session.id), { text: 'launch-env' }), 202)
    await turnEnd
    const launched = JSON.parse(textOf(p, session.id, '"args"')!) as { args: string[] }
    expect(launched.args).toEqual(expect.arrayContaining(['--permission-mode', 'default', '--agent', 'ana', '--strict-mcp-config']))
    await until(() => p.worktrees.get(lease.id)!.lastUsedAt > usedBefore)

    const decisionOpened = waitFor(p.sessions, session.id, 'decision_opened')
    const guardedTurn = waitFor(p.sessions, session.id, 'turn_end')
    await json(await call(p, 'POST', sessionPromptPath('alpha', session.id), { text: 'permission' }), 202)
    await decisionOpened
    const pending = p.decisions.list(session.id).find(d => d.state === 'pending')!
    expect(pending.options.map(o => o.kind)).toContain('deny')
    p.decisions.answer(pending.id, { optionKind: 'deny', surface: 'web', actorId: ADMIN.id })
    await guardedTurn
    expect(p.decisions.get(pending.id)).toMatchObject({ state: 'answered', answer: { optionKind: 'deny', surface: 'web', actorId: ADMIN.id } })

    const created = bd(lease.path, cleanEnv(session.posture!.env), 'create', '--title', 'Filed by the bot') as BdIssue
    const listed = bd(repo!.clone, cleanEnv(), 'list', '--all', '--limit', '0') as BdIssue[]
    expect(listed.map(issue => issue.id)).toContain(created.id)
    expect(existsSync(join(lease.path, '.beads'))).toBe(false)
    expect(repo!.git(lease.path, 'status', '--porcelain')).toBe('')
    expect(repo!.git(repo!.clone, 'status', '--porcelain')).toBe(statusBefore)

    const resumed = await json<BotSessionStartResponse>(await start(p, bot.id, threadId), 200)
    expect(resumed).toMatchObject({ resumed: true, session: { id: session.id, cwd: lease.path }, lease: { id: lease.id, path: lease.path }, thread: { id: threadId } })
    expect(p.sessions.list(project.id)).toHaveLength(1)

    const closed = await json<BotSessionCloseResponse>(await call(p, 'POST', botSessionClosePath('alpha', bot.id, session.id)), 200)
    expect(closed).toMatchObject({ released: true, keptUnpushed: false, session: { id: session.id }, lease: { id: lease.id } })
    expect(existsSync(lease.path)).toBe(false)
    expect(p.worktrees.get(lease.id)!.state).toBe('released')
    expect(repo!.git(repo!.clone, 'branch', '--list', lease.branch)).toContain(lease.branch)
    expect(repo!.git(repo!.clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(repo!.git(repo!.clone, 'status', '--porcelain')).toBe(statusBefore)

    const again = await json<BotSessionStartResponse>(await start(p, bot.id, threadId), 201)
    expect(again.session.id).not.toBe(session.id)
    expect(again.lease.path).not.toBe(lease.path)
    expect(again.thread).toMatchObject({ id: threadId, currentSessionId: again.session.id })
    expect(findThread(p.db, threadId)!.currentSessionId).toBe(again.session.id)
    expect(await json<BotSessionCloseResponse>(await call(p, 'POST', botSessionClosePath('alpha', bot.id, session.id)), 200)).toMatchObject({ released: false, keptUnpushed: false, lease: null })
    expect(await errorOf(await call(p, 'POST', botSessionClosePath('alpha', bot.id, 'nobody')))).toMatchObject({ status: 404, code: 'not_found' })
  }, 120_000)
})

describe('bot session starter', () => {
  it('fails a bot whose persona file is missing on the base branch, creating no worktree or session', async () => {
    const { p, project, bot } = await setup({ family: 'codex' })
    expect(await errorOf(await start(p, bot.id))).toMatchObject({ status: 422, code: 'persona_missing', message: expect.stringContaining('.agents/ana.md') })
    await expect(p.botSessions.start({ botId: bot.id, holder: { kind: 'slack', id: 'C1:1.0' }, actorId: 'slack-user' })).rejects.toMatchObject({ name: 'BotStartError', reason: 'persona_missing' })
    expect(p.worktrees.list(project.id)).toEqual([])
    expect(p.sessions.list(project.id)).toEqual([])
  })

  it('fails when the family plugin is not stored healthy, and names an unknown bot', async () => {
    const { p, project, bot } = await setup()
    setHealth(p, project.id, 'claude-code', false)
    expect(await errorOf(await start(p, bot.id))).toMatchObject({ status: 422, code: 'plugin_unhealthy', message: expect.stringContaining('Not logged in') })
    expect(await errorOf(await start(p, 'nobody'))).toMatchObject({ status: 404, code: 'not_found' })
    expect(await errorOf(await call(p, 'POST', botSessionsPath('alpha', bot.id), undefined, { ...ADMIN, id: 'dev', roles: ['developer'] }))).toMatchObject({ status: 403 })
  })

  it('refuses a session beyond the worktree cap without leaking a session row', async () => {
    const { p, project, bot } = await setup({ worktrees: { maxPerProject: 1 } })
    await json<BotSessionStartResponse>(await start(p, bot.id, 'first'), 201)
    expect(await errorOf(await start(p, bot.id, 'second'))).toMatchObject({ status: 409, code: 'worktree_cap' })
    expect(p.sessions.list(project.id)).toHaveLength(1)
    expect(p.worktrees.list(project.id)).toHaveLength(1)
  }, 60_000)

  it('runs a Codex bot for a Slack holder with the persona and instructions as developer instructions and bd in its environment', async () => {
    const { p, project, bot } = await setup({ family: 'codex', personaName: 'cody', beads: 'dir' })
    const holder = { kind: 'slack' as const, id: 'C0123:1700000000.000100' }
    const started = await p.botSessions.start({ botId: bot.id, holder, actorId: 'slack-user' })
    expect(started.thread).toBeNull()
    expect(started.session.posture?.codex).toMatchObject({ mode: 'workspace-write' })
    expect(started.session.posture!.codex!.developerInstructions!.startsWith('You are Cody.')).toBe(true)
    expect(started.session.posture!.codex!.developerInstructions).toContain('# Platform instructions')
    expect(started.session.posture!.codex!.developerInstructions).toContain('mcp__candy_mountain_slack__post_blocks')
    expect(started.session.posture!.flags).toBeUndefined()
    expect(p.botSessions.find(holder)?.id).toBe(started.session.id)

    const turnEnd = waitFor(p.sessions, started.session.id, 'turn_end')
    await p.botSessions.prompt(started.session.id, 'env')
    await turnEnd
    const names = JSON.parse(textOf(p, started.session.id, 'BEADS_DIR')!) as string[]
    expect(names).toEqual(expect.arrayContaining(['BEADS_DIR', 'BD_NON_INTERACTIVE', 'CODEX_HOME']))

    const again = await p.botSessions.start({ botId: bot.id, holder, actorId: 'slack-user' })
    expect(again).toMatchObject({ resumed: true, session: { id: started.session.id } })
    const closed = await p.botSessions.close(holder)
    expect(closed).toMatchObject({ released: true, keptUnpushed: false })
    expect(p.worktrees.list(project.id)).toEqual([])
    expect(await p.botSessions.close(holder)).toMatchObject({ released: false, lease: null })
    await expect(p.botSessions.prompt(started.session.id, 'env')).rejects.toMatchObject({ reason: 'worktree_released' })
  }, 60_000)

  for (const writeScope of ['write-confirm', 'write-auto'] as const) {
    it(`gives a ${writeScope} Codex bot the main checkout's beads directory as a writable root`, async () => {
      const { p, bot } = await setup({ family: 'codex', personaName: 'cody', writeScope, beads: 'dir' })
      const beadsDir = join(repo!.clone, '.beads')
      const started = await p.botSessions.start({ botId: bot.id, holder: { kind: 'slack', id: `C0123:${writeScope}` }, actorId: 'slack-user' })
      expect(started.session.posture?.codex).toMatchObject({ mode: 'workspace-write', writableRoots: [beadsDir] })

      const turnEnd = waitFor(p.sessions, started.session.id, 'turn_end')
      await p.botSessions.prompt(started.session.id, 'env:CODEX_CONFIG')
      await turnEnd
      const config = JSON.parse(JSON.parse(textOf(p, started.session.id, '"CODEX_CONFIG"')!).CODEX_CONFIG) as Record<string, unknown>
      expect(config.sandbox_workspace_write).toEqual({ writable_roots: [beadsDir] })

      const directoriesEnd = waitFor(p.sessions, started.session.id, 'turn_end')
      await p.botSessions.prompt(started.session.id, 'directories')
      await directoriesEnd
      expect(textOf(p, started.session.id, JSON.stringify([beadsDir]))).toBe(JSON.stringify([beadsDir]))
    }, 60_000)
  }

  it('gives a read-only Codex bot no writable roots', async () => {
    const { p, bot } = await setup({ family: 'codex', personaName: 'cody', writeScope: 'read-only', beads: 'dir' })
    const started = await p.botSessions.start({ botId: bot.id, holder: { kind: 'slack', id: 'C0123:read-only' }, actorId: 'slack-user' })
    expect(started.session.posture?.codex?.mode).toBe('read-only')
    expect(started.session.posture?.codex).not.toHaveProperty('writableRoots')

    const turnEnd = waitFor(p.sessions, started.session.id, 'turn_end')
    await p.botSessions.prompt(started.session.id, 'env:CODEX_CONFIG,INITIAL_AGENT_MODE')
    await turnEnd
    const env = JSON.parse(textOf(p, started.session.id, '"CODEX_CONFIG"')!) as Record<string, string>
    expect(env.INITIAL_AGENT_MODE).toBe('read-only')
    expect(JSON.parse(env.CODEX_CONFIG!)).not.toHaveProperty('sandbox_workspace_write')
  }, 60_000)

  it('keeps a worktree with uncommitted work on close and lets the write-auto sandbox write the issue database', async () => {
    const { p, project, bot } = await setup({ writeScope: 'write-auto', beads: 'dir' })
    const started = await json<BotSessionStartResponse>(await start(p, bot.id, 'thread-auto'), 201)
    const flags = started.session.posture!.flags!
    const settings = JSON.parse(flags[flags.indexOf('--settings') + 1]!) as { sandbox: { filesystem: { allowWrite: string[] } }, permissions: { ask: string[] } }
    expect(settings.sandbox.filesystem.allowWrite).toContain(join(repo!.clone, '.beads'))
    expect(settings.permissions.ask).toContain('Bash(git push *)')

    writeFileSync(join(started.lease.path, 'notes.md'), 'draft\n')
    const kept = await json<BotSessionCloseResponse>(await call(p, 'POST', botSessionClosePath('alpha', bot.id, started.session.id)), 200)
    expect(kept).toMatchObject({ released: false, keptUnpushed: true, lease: { unpushedWork: true, unpushedReason: expect.stringContaining('1 uncommitted change') } })
    expect(existsSync(started.lease.path)).toBe(true)
    expect(p.worktrees.list(project.id)).toHaveLength(1)

    rmSync(join(started.lease.path, 'notes.md'))
    const released = await json<BotSessionCloseResponse>(await call(p, 'POST', botSessionClosePath('alpha', bot.id, started.session.id)), 200)
    expect(released).toMatchObject({ released: true, keptUnpushed: false })
    expect(existsSync(started.lease.path)).toBe(false)
  }, 60_000)
})
