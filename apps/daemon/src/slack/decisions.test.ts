import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sessionDecisionPath, sessionDecisionsPath, sessionEventsPath, type Actor, type AgentSessionEvent, type AgentSessionEventKind, type Decision, type DecisionListResponse } from '@candy-mountain/shared'
import { eq, like } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins, fakeClaude } from '../acp/test-support'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { createBot, parseCreateBot, recordBotPersonaCheck, type BotReadDeps } from '../bots'
import { pluginInstances, platformMeta } from '../db/schema'
import { createPluginInstance } from '../plugins/instances/instances'
import { GOOD_TOKEN, stubHosts } from '../plugins/repository/fake-hosts'
import { createSlackClient, createSlackOperations } from '../plugins/slack'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject } from '../projects/projects'
import { startPlatform, type Platform, type PlatformOptions } from '../platform'
import { MasterKey } from '../secrets'
import type { SessionMessage } from '../sessions'
import { addTeamMember } from '../team'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createTempGitRepo, type TempGitRepo } from '../worktrees/test-repo'
import { parseSlackDecisionReply, slackAnswerFromText, slackDecisionChoices, slackDecisionMessage, slackDecisionShortId } from './decision-message'
import { startSlackDecisions } from './decisions'
import { createSlackEventBus, type SlackEventBus, type SlackInteractiveBotEvent, type SlackMessageBotEvent } from './events'
import { startSlackRouter } from './router'
import { findSlackThread } from './threads'

const CLAUDE_PERSONA = '---\nname: ana\ndescription: Ana fixes small issues.\n---\nYou are Ana. Keep changes small.\n'
const JACK = 'U0JACK'
const BOT_USER = 'U0BOT'
const ADMIN: Actor = { id: 'admin-actor', username: 'admin', displayName: 'Admin', roles: ['admin'] }

let temp: TempDataDir | undefined
let platform: Platform | undefined
let repo: TempGitRepo | undefined
let stops: (() => void)[] = []

afterEach(async () => {
  for (const stop of stops) stop()
  stops = []
  await platform?.sessions.close()
  platform?.close()
  platform = undefined
  temp?.cleanup()
  temp = undefined
  repo?.cleanup()
  repo = undefined
  vi.unstubAllGlobals()
})

interface SlackCall { method: string, body: Record<string, unknown> }

function fakeTransport() {
  const bus: SlackEventBus = createSlackEventBus({ error: () => {} })
  const calls: SlackCall[] = []
  const stamps = new Map<Record<string, unknown>, string>()
  let posted = 0
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const method = String(input).replace('https://slack.com/api/', '')
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ method, body })
    const reply = method === 'chat.postMessage' ? { ok: true, channel: body.channel, ts: `9.${++posted}` } : { ok: true }
    if (reply.ts) stamps.set(body, reply.ts)
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const slack = {
    subscribe: bus.subscribe,
    web: () => ({ client: createSlackClient('xoxb-test', { fetch }), operations: createSlackOperations({}, { get: () => 'xoxb-test' }, { fetch }) }),
  }
  const of = (method: string) => calls.filter(call => call.method === method).map(call => call.body)
  const tsOf = (body: Record<string, unknown>) => stamps.get(body)!
  return { bus, slack, calls, of, tsOf }
}

type Transport = ReturnType<typeof fakeTransport>

let eventCounter = 0

function messageEvent(botId: string, projectId: string, input: { kind?: 'app_mention' | 'message', user?: string, text: string, ts: string, threadTs?: string | null }): SlackMessageBotEvent {
  const event = { channel: 'C01LISTED', channelType: 'channel', user: input.user ?? JACK, senderBotId: null, subtype: null, text: input.text, ts: input.ts, threadTs: input.threadTs ?? null, raw: {} }
  return { kind: input.kind ?? 'message', botId, projectId, envelopeId: `env-${++eventCounter}`, retryAttempt: 0, retryReason: null, receivedAt: new Date().toISOString(), botUserId: BOT_USER, eventId: `Ev${eventCounter}`, teamId: 'T0CANDY', fromSelf: false, event }
}

function press(botId: string, projectId: string, message: { ts: string }, value: string, user = JACK): SlackInteractiveBotEvent {
  return {
    kind: 'interactive',
    botId,
    projectId,
    envelopeId: `env-${++eventCounter}`,
    retryAttempt: 0,
    retryReason: null,
    receivedAt: new Date().toISOString(),
    botUserId: BOT_USER,
    interaction: { type: 'block_actions', userId: user, channelId: 'C01LISTED', messageTs: message.ts, threadTs: '1.1', actions: [{ actionId: `cm-decision:${value.split(':')[1]}`, blockId: null, type: 'button', value }], responseUrl: null, triggerId: null, raw: {} },
  }
}

function commitFile(path: string, text: string): void {
  const file = join(repo!.clone, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  repo!.git(repo!.clone, 'add', path)
  repo!.git(repo!.clone, 'commit', '--quiet', '-m', `add ${path}`)
  repo!.git(repo!.clone, 'push', '--quiet', 'origin', 'main')
}

function setHealth(p: Platform, projectId: string, type: 'repository' | 'claude-code', config: Record<string, unknown> = {}, secrets: Record<string, string> = {}): void {
  const existing = p.db.select().from(pluginInstances).where(eq(pluginInstances.projectId, projectId)).all().find(row => row.typeId === type)
  const id = existing?.id ?? createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type, scope: 'project', projectId, config, secrets }).id
  p.db.update(pluginInstances).set({ health: { healthy: true }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, id)).run()
}

const readDeps = (p: Platform): BotReadDeps => ({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets })

function boot(dataDir: string, key: MasterKey, decisions?: PlatformOptions['decisions']): Platform {
  platform = startPlatform(dataDir, { secretsKey: key, acp: { bins: fakeBins, killTimeoutMs: 1000 }, decisions })
  return platform
}

/** The Slack side wired as the platform wires it, but against a recording transport. */
function wire(p: Platform) {
  const transport = fakeTransport()
  const decisions = startSlackDecisions({ db: p.db, slack: transport.slack, decisions: p.decisions, sessions: p.sessions }, { log: { error: () => {} } })
  const router = startSlackRouter({ db: p.db, slack: transport.slack, botSessions: p.botSessions, sessions: p.sessions, interceptReply: decisions.interceptReply }, { log: { error: () => {} } })
  stops.push(() => router.close(), () => decisions.close())
  const idle = async () => {
    await router.idle()
    await decisions.idle()
  }
  return { ...transport, decisions, router, idle }
}

async function setup(decisions?: PlatformOptions['decisions']) {
  repo = createTempGitRepo()
  commitFile('.claude/agents/ana.md', CLAUDE_PERSONA)
  stubHosts()
  temp = createTempDataDir()
  const key = MasterKey.generate()
  const p = boot(temp.root, key, decisions)
  const project = await createProject(p.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: repo.clone } })
  setHealth(p, project.id, 'repository', { host: 'github', owner: 'jack', repo: 'candy' }, { token: GOOD_TOKEN })
  setHealth(p, project.id, 'claude-code', { claudePath: fakeClaude(temp.root) })
  // The panel's session routes are gated on the Agent Hub's chat capabilities.
  setEnabledModules(p.db, project.id, ['agent-hub'])
  const bot = await createBot(readDeps(p), project.id, parseCreateBot({ name: 'Ana Bot', family: 'claude-code', writeScope: 'write-confirm', personaName: 'ana', answersIn: { channels: ['C01LISTED'] } }))
  expect(recordBotPersonaCheck(p.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(true)
  addTeamMember(p.db, project.id, { displayName: 'Jack', email: null, slackMemberId: JACK, botScope: { all: true } })
  return { p, project, bot, key }
}

/** Opens the thread through the router, then has the agent raise `scenario` the way a turn would. */
async function raise(p: Platform, t: ReturnType<typeof wire>, botId: string, projectId: string, scenario: string) {
  let thread = findSlackThread(p.db, { botId, channelId: 'C01LISTED', threadTs: '1.1' })
  if (!thread) {
    t.bus.emit(messageEvent(botId, projectId, { kind: 'app_mention', text: `<@${BOT_USER}> start`, ts: '1.1' }))
    await t.idle()
    thread = findSlackThread(p.db, { botId, channelId: 'C01LISTED', threadTs: '1.1' })!
  }
  const opened = waitFor(p, thread.sessionId, 'decision_opened')
  const turnEnd = waitFor(p, thread.sessionId, 'turn_end')
  await p.botSessions.prompt(thread.sessionId, scenario)
  const event = await opened
  await t.idle()
  const decision = (event as Extract<AgentSessionEvent, { kind: 'decision_opened' }>).decision
  const post = t.of('chat.postMessage').find(body => JSON.stringify(body.blocks ?? []).includes(decision.id))!
  return { sessionId: thread.sessionId, decision, post, turnEnd }
}

function waitFor(p: Platform, id: string, kind: AgentSessionEventKind): Promise<AgentSessionEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`No ${kind} event`)) }, 15_000)
    const unsubscribe = p.sessions.subscribe(id, (message: SessionMessage) => {
      if (message.type !== 'event' || message.event.kind !== kind) return
      clearTimeout(timer)
      unsubscribe()
      resolve(message.event)
    })
  })
}

function call(p: Platform, method: string, path: string, body?: unknown) {
  const auth: AuthStrategy = { name: 'development', resolve: () => ADMIN }
  const app = createApp({ db: p.db, paths: p.paths, auth, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets, sessions: p.sessions, decisions: p.decisions, botSessions: p.botSessions })
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return app.request(path, init)
}

/** The panel's view: rows replayed on the SSE stream, read until the decision is settled. */
async function streamedOutcome(p: Platform, sessionId: string, decisionId: string): Promise<AgentSessionEvent> {
  const res = await call(p, 'GET', sessionEventsPath('alpha', sessionId))
  expect(res.status).toBe(200)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) throw new Error('Stream ended before the decision settled')
      buffer += decoder.decode(value, { stream: true })
      for (const block of buffer.split('\n\n')) {
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (!block.includes('event: session') || !data) continue
        const event = JSON.parse(data) as AgentSessionEvent
        if ((event.kind === 'decision_answered' || event.kind === 'decision_expired') && event.decisionId === decisionId) return event
      }
    }
  }
  finally {
    await reader.cancel()
  }
}

const buttons = (body: Record<string, unknown>) => {
  const actions = (body.blocks as { type: string, elements?: { text: { text: string }, value: string }[] }[]).find(block => block.type === 'actions')
  return actions?.elements?.map(element => ({ text: element.text.text, value: element.value })) ?? []
}
const blockText = (body: Record<string, unknown>) => JSON.stringify(body.blocks)
const updatesOf = (t: Transport, post: Record<string, unknown>, ts: string) => t.of('chat.update').filter(body => body.ts === ts && body.channel === post.channel)

describe('Slack decisions', () => {
  it('posts buttons for a permission, and pressing Allow continues the tool and settles the panel card', async () => {
    const { p, project, bot } = await setup()
    const t = wire(p)
    const { sessionId, decision, post, turnEnd } = await raise(p, t, bot.id, project.id, 'permission')
    const short = slackDecisionShortId(decision.id)

    expect(post).toMatchObject({ channel: 'C01LISTED', thread_ts: '1.1' })
    expect(String(post.text)).toContain(`Permission needed (${short})`)
    const offered = buttons(post)
    expect(offered.map(button => button.text)).toEqual(['1. Allow once', ...decision.options.filter(o => o.kind === 'allow_always').map((_, i) => expect.stringMatching(new RegExp(`^${i + 2}\\. Always allow `))), `${offered.length}. Deny`])
    expect(offered.length).toBeGreaterThan(2)
    expect(blockText(post)).toContain(`yes ${short}`)
    expect(blockText(post)).toContain('git status')
    expect(p.db.select().from(platformMeta).where(eq(platformMeta.key, `slack-decision:${decision.id}`)).get()).toBeDefined()

    // Someone outside the roster pressing a button changes nothing.
    t.bus.emit(press(bot.id, project.id, { ts: t.tsOf(post) }, offered[0]!.value, 'U0STRANGER'))
    await t.idle()
    expect(p.decisions.get(decision.id)!.state).toBe('pending')

    const ts = t.tsOf(post)
    t.bus.emit(press(bot.id, project.id, { ts }, offered[0]!.value))
    await turnEnd
    await t.idle()

    expect(p.decisions.get(decision.id)).toMatchObject({ state: 'answered', answer: { optionKind: 'allow_once', surface: 'slack', actorId: `slack:${JACK}` } })
    const result = p.sessions.events(sessionId).filter(e => e.kind === 'text' && e.role === 'agent').map(e => (e.kind === 'text' ? e.text : '')).join('')
    expect(result).toContain('"behavior":"allow"')

    // The chat panel reads the same answer from the stream and the REST list.
    expect(await streamedOutcome(p, sessionId, decision.id)).toMatchObject({ kind: 'decision_answered', answer: { optionKind: 'allow_once', surface: 'slack' } })
    const listed = await (await call(p, 'GET', sessionDecisionsPath('alpha', sessionId))).json() as DecisionListResponse
    expect(listed.decisions.find(d => d.id === decision.id)).toMatchObject({ state: 'answered', answer: { surface: 'slack' } })

    const [update] = updatesOf(t, post, ts)
    expect(update).toBeDefined()
    expect(blockText(update!)).toContain(`Allowed once by <@${JACK}> in Slack`)
    expect(buttons(update!)).toEqual([])
    expect(p.db.select().from(platformMeta).where(like(platformMeta.key, 'slack-decision:%')).all()).toEqual([])
  }, 120_000)

  it('updates the Slack message when the panel answers first, and a late button press loses', async () => {
    const { p, project, bot } = await setup()
    const t = wire(p)
    const { sessionId, decision, post, turnEnd } = await raise(p, t, bot.id, project.id, 'permission:plain')
    const offered = buttons(post)
    expect(offered.map(button => button.text)).toEqual(['1. Allow once', '2. Deny'])

    const res = await call(p, 'POST', sessionDecisionPath('alpha', sessionId, decision.id), { optionKind: 'allow_once' })
    expect(res.status).toBe(200)
    await turnEnd
    await t.idle()
    const ts = t.tsOf(post)
    const updates = updatesOf(t, post, ts)
    expect(updates).toHaveLength(1)
    expect(blockText(updates[0]!)).toContain('Allowed once in the web app')

    t.bus.emit(press(bot.id, project.id, { ts }, offered[1]!.value))
    await t.idle()
    expect(p.decisions.get(decision.id)).toMatchObject({ state: 'answered', answer: { optionKind: 'allow_once', surface: 'web', actorId: ADMIN.id } })
    expect(updatesOf(t, post, ts)).toHaveLength(2)
    expect(blockText(updatesOf(t, post, ts)[1]!)).toContain('Allowed once in the web app')
  }, 120_000)

  it('answers from text replies without prompting the agent', async () => {
    const { p, project, bot } = await setup()
    const t = wire(p)
    const first = await raise(p, t, bot.id, project.id, 'permission')
    const short = slackDecisionShortId(first.decision.id)
    const prompts = () => p.sessions.events(first.sessionId).filter(e => e.kind === 'prompt').length
    const promptsBefore = prompts()

    t.bus.emit(messageEvent(bot.id, project.id, { text: `no ${short} touches the *wrong* tree`, ts: '1.5', threadTs: '1.1' }))
    await first.turnEnd
    await t.idle()
    expect(p.decisions.get(first.decision.id)).toMatchObject({ state: 'answered', answer: { optionKind: 'deny', explanation: 'touches the *wrong* tree', surface: 'slack', actorId: `slack:${JACK}` } })
    expect(prompts()).toBe(promptsBefore)
    expect(t.of('reactions.add').at(-1)).toMatchObject({ channel: 'C01LISTED', timestamp: '1.5', name: 'white_check_mark' })
    expect(blockText(t.of('chat.update').at(-1)!)).toContain(`Denied by <@${JACK}> in Slack`)

    // A verb for a settled decision is still consumed, and says why it did nothing.
    t.bus.emit(messageEvent(bot.id, project.id, { text: `yes ${short}`, ts: '1.6', threadTs: '1.1' }))
    await t.idle()
    expect(prompts()).toBe(promptsBefore)
    expect(String(t.of('chat.postMessage').at(-1)!.text)).toMatch(new RegExp(`^Could not answer \`${short}\`: Already answered`))

    const question = await raise(p, t, bot.id, project.id, 'question:single')
    const q = slackDecisionShortId(question.decision.id)
    expect(buttons(question.post).map(button => button.text)).toEqual(['1. prettier', '2. dprint', '3. Decline'])
    t.bus.emit(messageEvent(bot.id, project.id, { text: `choose 2 ${q}`, ts: '1.7', threadTs: '1.1' }))
    await question.turnEnd
    await t.idle()
    expect(p.decisions.get(question.decision.id)).toMatchObject({ state: 'answered', answer: { optionKind: 'answer', answer: { question_0: 'dprint' }, surface: 'slack' } })
    expect(blockText(t.of('chat.update').at(-1)!)).toContain('Format: dprint')

    const free = await raise(p, t, bot.id, project.id, 'question:single')
    t.bus.emit(messageEvent(bot.id, project.id, { text: `answer ${slackDecisionShortId(free.decision.id)} biome, please`, ts: '1.8', threadTs: '1.1' }))
    await free.turnEnd
    await t.idle()
    expect(p.decisions.get(free.decision.id)).toMatchObject({ state: 'answered', answer: { answer: { question_0: 'biome, please' } } })
    expect(prompts()).toBe(promptsBefore + 2)

    // A verb naming no decision of this thread is an ordinary reply.
    t.bus.emit(messageEvent(bot.id, project.id, { text: 'yes ffffff', ts: '1.9', threadTs: '1.1' }))
    await t.idle()
    expect(prompts()).toBe(promptsBefore + 3)
  }, 120_000)

  it('shows refused when nobody answers in time', async () => {
    const { p, project, bot } = await setup({ timeoutMs: 400 })
    const t = wire(p)
    const { decision, post, turnEnd } = await raise(p, t, bot.id, project.id, 'permission')
    await turnEnd
    await t.idle()
    expect(p.decisions.get(decision.id)).toMatchObject({ state: 'expired', expiry: { reason: 'timeout' } })
    const update = updatesOf(t, post, t.tsOf(post)).at(-1)!
    expect(blockText(update)).toContain('*Refused*')
    expect(blockText(update)).toContain('Nobody answered in time')
    expect(buttons(update)).toEqual([])
  }, 120_000)

  it('settles a message whose decision died with the daemon on the next start', async () => {
    const { p: first, project, bot, key } = await setup()
    const before = wire(first)
    const { decision, post } = await raise(first, before, bot.id, project.id, 'permission')
    const ts = before.tsOf(post)
    for (const stop of stops) stop()
    stops = []
    // As in platform.close(): decisions stop before the agents do, so the log keeps the decision pending, as after a crash.
    first.decisions.close()
    await first.sessions.close()
    first.close()

    const p = boot(temp!.root, key)
    const key0 = `slack-decision:${decision.id}`
    expect(p.db.select().from(platformMeta).where(eq(platformMeta.key, key0)).get()).toBeDefined()
    const after = wire(p)
    await after.idle()
    const update = after.of('chat.update').at(-1)!
    expect(update).toMatchObject({ channel: 'C01LISTED', ts })
    expect(blockText(update)).toContain('*Refused*')
    expect(blockText(update)).toContain('The agent process ended before anyone answered.')
    expect(buttons(update)).toEqual([])
    expect(p.db.select().from(platformMeta).where(eq(platformMeta.key, key0)).get()).toBeUndefined()

    // A press on the stale buttons re-renders the outcome rather than answering.
    after.bus.emit(press(bot.id, project.id, { ts }, `${decision.id}:1`))
    await after.idle()
    expect(after.of('chat.update')).toHaveLength(2)
    expect(p.decisions.get(decision.id)!.state).toBe('expired')
  }, 120_000)
})

const decisionOf = (input: Partial<Decision>): Decision => ({
  id: '0a1b2c3d-0000-4000-8000-000000000000',
  sessionId: 's',
  requestId: 'r',
  kind: 'permission',
  toolCall: { title: 'Run <rm>', rawInput: { command: 'rm -rf build' } },
  request: null,
  options: [],
  createdAt: '2026-10-28T00:00:00.000Z',
  expiresAt: '2026-10-28T00:05:00.000Z',
  state: 'pending',
  answer: null,
  expiry: null,
  ...input,
})

describe('Slack decision helpers', () => {
  it('parses verbs followed by the id', () => {
    expect(parseSlackDecisionReply('yes 0a1b2c')).toEqual({ verb: 'yes', words: ['0a1b2c'], rest: '' })
    expect(parseSlackDecisionReply('*No* 0a1b2c not now')).toEqual({ verb: 'no', words: ['0a1b2c', 'not', 'now'], rest: 'not now' })
    expect(parseSlackDecisionReply('choose 0a1b2c 2')).toMatchObject({ verb: 'choose', words: ['0a1b2c', '2'] })
    expect(parseSlackDecisionReply('answer 0a1b2c\nFormat: dprint\nTargets: web')).toMatchObject({ verb: 'answer', rest: 'Format: dprint\nTargets: web' })
    for (const text of ['yes', 'no.', 'sure 0a1b2c', 'yesterday 0a1b2c']) expect(parseSlackDecisionReply(text), text).toBeNull()
  })

  it('offers always-allow only for rules the agent proposed, in a fixed order', () => {
    const plain = decisionOf({ options: [{ kind: 'deny', optionId: 'no', label: 'Deny', meta: null }, { kind: 'allow_once', optionId: 'once', label: 'Allow once', meta: null }] })
    expect(slackDecisionChoices(plain).map(choice => choice.label)).toEqual(['Allow once', 'Deny'])
    const rules = decisionOf({ options: [...plain.options, { kind: 'allow_always', optionId: 'rule-0', label: 'Always allow Bash(ls)', meta: { rule: 'Bash(ls:*)' } }] })
    expect(slackDecisionChoices(rules).map(choice => [choice.label, choice.request])).toEqual([
      ['Allow once', { optionKind: 'allow_once', optionId: 'once' }],
      ['Always allow Bash(ls:*)', { optionKind: 'allow_always', optionId: 'rule-0' }],
      ['Deny', { optionKind: 'deny', optionId: 'no' }],
    ])
    expect(JSON.stringify(slackDecisionMessage(plain).blocks)).toContain('Run &lt;rm&gt;')
  })

  it('reads answers to several fields one line each', () => {
    const question = decisionOf({
      kind: 'question',
      toolCall: null,
      request: { message: 'Two questions', requestedSchema: { type: 'object', properties: { question_0: { type: 'string', title: 'Format', oneOf: [{ const: 'prettier' }, { const: 'dprint' }] }, question_1: { type: 'array', title: 'Targets', items: { type: 'string', enum: ['web', 'node'] } }, count: { type: 'integer' } } } },
    })
    expect(slackAnswerFromText(question, 'Format: DPRINT\ntargets: web, node\ncount: 3')).toEqual({ ok: true, value: { question_0: 'dprint', question_1: ['web', 'node'], count: 3 } })
    expect(slackAnswerFromText(question, 'Format: biome')).toMatchObject({ ok: false })
    expect(slackAnswerFromText(question, 'just this')).toMatchObject({ ok: false })
    expect(slackDecisionChoices(question).map(choice => choice.label)).toEqual(['Decline'])
  })
})
