import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BotAnswersIn } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins, fakeClaude } from '../acp/test-support'
import { createBot, parseCreateBot, recordBotPersonaCheck, type BotReadDeps } from '../bots'
import { pluginInstances, slackThreads } from '../db/schema'
import { createPluginInstance } from '../plugins/instances/instances'
import { GOOD_TOKEN, stubHosts } from '../plugins/repository/fake-hosts'
import { createSlackClient, createSlackOperations } from '../plugins/slack'
import { createProject } from '../projects/projects'
import { startPlatform, type Platform } from '../platform'
import { MasterKey } from '../secrets'
import { addTeamMember, listTeamMembers, removeTeamMember } from '../team'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createTempGitRepo, type TempGitRepo } from '../worktrees/test-repo'
import { createSlackEventBus, type SlackEventBus, type SlackMessageBotEvent } from './events'
import { slackTextToPlain, splitSlackText } from './post'
import { isDoneMessage, slackRequestText, startSlackRouter, type SlackRouter } from './router'
import { findSlackThread } from './threads'

const CLAUDE_PERSONA = '---\nname: ana\ndescription: Ana fixes small issues.\n---\nYou are Ana. Keep changes small.\n'
const JACK = 'U0JACK'
const BOT_USER = 'U0BOT'

let temp: TempDataDir | undefined
let platform: Platform | undefined
let repo: TempGitRepo | undefined
let router: SlackRouter | undefined

afterEach(async () => {
  router?.close()
  router = undefined
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

/** The router's whole view of Slack: an event bus to drive it and a Web API that records what it posts. */
function fakeTransport() {
  const bus: SlackEventBus = createSlackEventBus({ error: () => {} })
  const calls: SlackCall[] = []
  let posted = 0
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const method = String(input).replace('https://slack.com/api/', '')
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ method, body })
    const reply = method === 'chat.postMessage' ? { ok: true, channel: body.channel, ts: `9.${++posted}` } : { ok: true }
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const slack = {
    subscribe: bus.subscribe,
    web: () => ({ client: createSlackClient('xoxb-test', { fetch }), operations: createSlackOperations({}, { get: () => 'xoxb-test' }, { fetch }) }),
  }
  const posts = () => calls.filter(call => call.method === 'chat.postMessage').map(call => ({ channel: call.body.channel, threadTs: call.body.thread_ts, text: String(call.body.text) }))
  const reactions = () => calls.filter(call => call.method === 'reactions.add').map(call => ({ channel: call.body.channel, ts: call.body.timestamp, name: call.body.name }))
  return { bus, slack, calls, posts, reactions }
}

let eventCounter = 0

function messageEvent(botId: string, projectId: string, input: { kind?: 'app_mention' | 'message', channel?: string, user?: string | null, text: string, ts: string, threadTs?: string | null, eventId?: string, fromSelf?: boolean, subtype?: string | null }): SlackMessageBotEvent {
  const channel = input.channel ?? 'C01LISTED'
  const event = { channel, channelType: 'channel', user: input.user === undefined ? JACK : input.user, senderBotId: null, subtype: input.subtype ?? null, text: input.text, ts: input.ts, threadTs: input.threadTs ?? null, raw: {} }
  return { kind: input.kind ?? 'app_mention', botId, projectId, envelopeId: `env-${++eventCounter}`, retryAttempt: 0, retryReason: null, receivedAt: new Date().toISOString(), botUserId: BOT_USER, eventId: input.eventId ?? `Ev${eventCounter}`, teamId: 'T0CANDY', fromSelf: input.fromSelf ?? false, event }
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

function boot(dataDir: string, key: MasterKey): Platform {
  platform = startPlatform(dataDir, { secretsKey: key, acp: { bins: fakeBins, killTimeoutMs: 1000 } })
  return platform
}

function route(p: Platform) {
  const transport = fakeTransport()
  router = startSlackRouter({ db: p.db, slack: transport.slack, botSessions: p.botSessions, sessions: p.sessions }, { log: { error: () => {} } })
  return { ...transport, router }
}

/** Project `alpha` on a temp clone with persona `ana`; one verified bot answering in C01LISTED; Jack on the roster with scope all. */
async function setup(answersIn: BotAnswersIn = { channels: ['C01LISTED'] }) {
  repo = createTempGitRepo()
  commitFile('.claude/agents/ana.md', CLAUDE_PERSONA)
  stubHosts()
  temp = createTempDataDir()
  const key = MasterKey.generate()
  const p = boot(temp.root, key)
  const project = await createProject(p.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: repo.clone } })
  setHealth(p, project.id, 'repository', { host: 'github', owner: 'jack', repo: 'candy' }, { token: GOOD_TOKEN })
  setHealth(p, project.id, 'claude-code', { claudePath: fakeClaude(temp.root) })
  const bot = await createBot(readDeps(p), project.id, parseCreateBot({ name: 'Ana Bot', family: 'claude-code', writeScope: 'write-confirm', personaName: 'ana', answersIn }))
  expect(recordBotPersonaCheck(p.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(true)
  const member = addTeamMember(p.db, project.id, { displayName: 'Jack', email: null, slackMemberId: JACK, botScope: { all: true } })
  return { p, project, bot, member, key }
}

async function send(p: Platform, bus: SlackEventBus, r: SlackRouter, event: SlackMessageBotEvent): Promise<void> {
  bus.emit(event)
  await r.idle()
}

describe('Slack routing', () => {
  it('starts a session in a worktree on a roster mention, continues on replies, stays silent otherwise, ignores replays and releases on done', async () => {
    const { p, project, bot, member } = await setup()
    const t = route(p)
    const ref = { botId: bot.id, channelId: 'C01LISTED', threadTs: '1.1' }
    const event = (input: Parameters<typeof messageEvent>[2]) => messageEvent(bot.id, project.id, input)

    await send(p, t.bus, t.router, event({ text: `<@${BOT_USER}> fix &lt;issue&gt; wt-1 please`, ts: '1.1', eventId: 'Ev-mention' }))
    const thread = findSlackThread(p.db, ref)
    expect(thread).toMatchObject({ projectId: project.id, botId: bot.id, teamId: 'T0CANDY', slackMemberId: JACK, state: 'open', turnCount: 1 })
    const session = p.sessions.get(thread!.sessionId)!
    expect(session.posture?.bot).toEqual({ id: bot.id, name: 'Ana Bot', holder: { kind: 'slack', id: `${bot.id}:C01LISTED:1.1` } })
    expect(session.actorId).toBe(`slack:${JACK}`)
    const lease = p.botSessions.lease(session.id)!
    expect(lease).toMatchObject({ state: 'active', branch: `cm/bot/ana-bot/${session.id}` })
    expect(session.cwd).toBe(lease.path)
    expect(lease.path.startsWith(p.paths.worktrees)).toBe(true)
    expect(t.reactions()).toEqual([{ channel: 'C01LISTED', ts: '1.1', name: 'eyes' }])
    expect(t.posts()).toHaveLength(1)
    expect(t.posts()[0]).toMatchObject({ channel: 'C01LISTED', threadTs: '1.1' })
    const first = t.posts()[0]!.text
    expect(first).toContain('A request arrived from Slack.')
    expect(first).toContain('<slack-request>\nfrom: Jack (U0JACK)\nchannel: C01LISTED\nthread: 1.1\nmessage:\nfix <issue> wt-1 please\n</slack-request>')
    expect(first).not.toContain(BOT_USER)
    expect(listTeamMembers(p.db, project.id)[0]?.lastActiveAt).not.toBeNull()

    // A redelivery of the same event, and the message event Slack sends next to the mention, change nothing.
    await send(p, t.bus, t.router, event({ text: `<@${BOT_USER}> fix &lt;issue&gt; wt-1 please`, ts: '1.1', eventId: 'Ev-mention' }))
    await send(p, t.bus, t.router, event({ kind: 'message', text: `<@${BOT_USER}> fix &lt;issue&gt; wt-1 please`, ts: '1.1', eventId: 'Ev-mention-as-message' }))
    expect(t.posts()).toHaveLength(1)
    expect(t.reactions()).toHaveLength(1)

    await send(p, t.bus, t.router, event({ kind: 'message', text: 'also add a test', ts: '1.2', threadTs: '1.1' }))
    expect(findSlackThread(p.db, ref)).toMatchObject({ sessionId: session.id, turnCount: 2 })
    expect(t.posts()).toHaveLength(2)
    expect(t.posts()[1]).toEqual({ channel: 'C01LISTED', threadTs: '1.1', text: '<slack-reply>\nfrom: Jack (U0JACK)\nchannel: C01LISTED\nthread: 1.1\nmessage:\nalso add a test\n</slack-reply>' })
    expect(p.sessions.events(session.id).filter(e => e.kind === 'prompt')).toHaveLength(2)

    // Silence: a non-member, a channel the bot does not answer in, a top-level message without a mention, the bot itself, an edit.
    await send(p, t.bus, t.router, event({ user: 'U0STRANGER', text: `<@${BOT_USER}> hello`, ts: '2.1' }))
    await send(p, t.bus, t.router, event({ channel: 'C02OTHER', text: `<@${BOT_USER}> hello`, ts: '3.1' }))
    await send(p, t.bus, t.router, event({ kind: 'message', text: 'no mention here', ts: '4.1' }))
    await send(p, t.bus, t.router, event({ kind: 'message', user: BOT_USER, fromSelf: true, text: 'on it', ts: '1.3', threadTs: '1.1' }))
    await send(p, t.bus, t.router, event({ kind: 'message', subtype: 'message_changed', text: 'edited', ts: '1.4', threadTs: '1.1' }))
    await send(p, t.bus, t.router, event({ kind: 'message', user: 'U0STRANGER', text: 'me too', ts: '1.5', threadTs: '1.1' }))
    expect(p.db.select().from(slackThreads).all()).toHaveLength(1)
    expect(t.posts()).toHaveLength(2)
    expect(t.reactions()).toHaveLength(2)

    // The thread stops once its member leaves the roster, and picks up again when they are back.
    removeTeamMember(p.db, project.id, member.id)
    await send(p, t.bus, t.router, event({ kind: 'message', text: 'still there?', ts: '1.6', threadTs: '1.1' }))
    expect(t.posts()).toHaveLength(2)
    addTeamMember(p.db, project.id, { displayName: 'Jack', email: null, slackMemberId: JACK, botScope: { botIds: [bot.id] } })
    await send(p, t.bus, t.router, event({ kind: 'message', text: 'still there?', ts: '1.7', threadTs: '1.1' }))
    expect(t.posts()).toHaveLength(3)

    await send(p, t.bus, t.router, event({ kind: 'message', text: ' Done. ', ts: '1.8', threadTs: '1.1' }))
    expect(findSlackThread(p.db, ref)).toMatchObject({ state: 'closed', sessionId: session.id })
    expect(p.botSessions.lease(session.id)).toMatchObject({ state: 'released' })
    expect(existsSync(lease.path)).toBe(false)
    expect(t.posts().at(-1)).toMatchObject({ threadTs: '1.1', text: `Done. The worktree was released; branch \`${lease.branch}\` is kept.` })
    expect(repo!.git(repo!.clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')

    // A plain reply in a closed thread is ignored; a new mention there starts over in a fresh worktree.
    await send(p, t.bus, t.router, event({ kind: 'message', text: 'one more thing', ts: '1.9', threadTs: '1.1' }))
    expect(t.posts()).toHaveLength(4)
    await send(p, t.bus, t.router, event({ text: `<@${BOT_USER}> one more thing`, ts: '1.10', threadTs: '1.1' }))
    const reopened = findSlackThread(p.db, ref)!
    expect(reopened.state).toBe('open')
    expect(reopened.sessionId).not.toBe(session.id)
    expect(p.botSessions.lease(reopened.sessionId)).toMatchObject({ state: 'active' })
    expect(t.posts()).toHaveLength(5)
    expect(t.posts().at(-1)!.text).toContain('one more thing')
  }, 120_000)

  it('keeps an unpushed worktree on done and says so', async () => {
    const { p, project, bot } = await setup({ anywhere: true })
    const t = route(p)
    await send(p, t.bus, t.router, messageEvent(bot.id, project.id, { channel: 'C09ANY', text: `<@${BOT_USER}> start`, ts: '5.1' }))
    const thread = findSlackThread(p.db, { botId: bot.id, channelId: 'C09ANY', threadTs: '5.1' })!
    const lease = p.botSessions.lease(thread.sessionId)!
    writeFileSync(join(lease.path, 'fix.txt'), 'fixed\n')
    await send(p, t.bus, t.router, messageEvent(bot.id, project.id, { kind: 'message', channel: 'C09ANY', text: 'done', ts: '5.2', threadTs: '5.1' }))
    expect(findSlackThread(p.db, { botId: bot.id, channelId: 'C09ANY', threadTs: '5.1' })).toMatchObject({ state: 'closed' })
    expect(p.botSessions.lease(thread.sessionId)).toMatchObject({ state: 'active', unpushedWork: true })
    expect(existsSync(join(lease.path, 'fix.txt'))).toBe(true)
    expect(t.posts().at(-1)!.text).toMatch(/^Done\. The session is closed, but the worktree was kept because it holds work that is not on origin: .*uncommitted/)
  }, 120_000)

  it('resumes the same session when the first reply arrives after a restart', async () => {
    const { p: first, project, bot, key } = await setup()
    const before = route(first)
    await send(first, before.bus, before.router, messageEvent(bot.id, project.id, { text: `<@${BOT_USER}> start`, ts: '7.1' }))
    const thread = findSlackThread(first.db, { botId: bot.id, channelId: 'C01LISTED', threadTs: '7.1' })!
    expect(before.posts()).toHaveLength(1)

    before.router.close()
    await first.sessions.close()
    first.close()
    const p = boot(temp!.root, key)
    const after = route(p)
    expect(p.sessions.get(thread.sessionId)).toMatchObject({ status: 'idle' })
    await send(p, after.bus, after.router, messageEvent(bot.id, project.id, { kind: 'message', text: 'after restart', ts: '7.2', threadTs: '7.1' }))
    expect(findSlackThread(p.db, { botId: bot.id, channelId: 'C01LISTED', threadTs: '7.1' })).toMatchObject({ sessionId: thread.sessionId, turnCount: 2 })
    expect(p.sessions.get(thread.sessionId)!.cwd).toBe(p.botSessions.lease(thread.sessionId)!.path)
    expect(after.posts()).toHaveLength(1)
    expect(after.posts()[0]).toMatchObject({ threadTs: '7.1', text: expect.stringContaining('after restart') })
    expect(p.sessions.events(thread.sessionId).some(e => e.kind === 'text' && e.role === 'agent' && e.text.includes('after restart'))).toBe(true)
  }, 120_000)
})

describe('Slack message helpers', () => {
  it('recognises "done" on its own only', () => {
    for (const text of ['done', 'Done', ' DONE. ', '*done*', '`done`', 'done!']) expect(isDoneMessage(text), text).toBe(true)
    for (const text of ['done with that', 'not done', 'undone', '']) expect(isDoneMessage(text), text).toBe(false)
  })

  it('turns Slack mrkdwn into plain text for the agent', () => {
    expect(slackTextToPlain(`<@${BOT_USER}> look at <https://x.test/a|the page> and <https://y.test> &amp; a &lt;b&gt;`, BOT_USER)).toBe('look at the page (https://x.test/a) and https://y.test & a <b>')
    expect(slackTextToPlain('<@U0OTHER> hi', null)).toBe('<@U0OTHER> hi')
  })

  it('wraps the request with who asked and where', () => {
    const text = slackRequestText({ first: true, from: 'Jack', memberId: JACK, channel: 'C01LISTED', threadTs: '1.1', text: 'fix it' })
    expect(text.startsWith('A request arrived from Slack.')).toBe(true)
    expect(text.endsWith('<slack-request>\nfrom: Jack (U0JACK)\nchannel: C01LISTED\nthread: 1.1\nmessage:\nfix it\n</slack-request>')).toBe(true)
    expect(slackRequestText({ first: false, from: 'Jack', memberId: JACK, channel: 'C01LISTED', threadTs: '1.1', text: 'more' })).toBe('<slack-reply>\nfrom: Jack (U0JACK)\nchannel: C01LISTED\nthread: 1.1\nmessage:\nmore\n</slack-reply>')
  })

  it('splits long text on line breaks under the Slack limit', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(20)}`)
    const parts = splitSlackText(lines.join('\n'))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every(part => part.length <= 3900)).toBe(true)
    expect(parts.join('\n').split('\n')).toEqual(lines)
    expect(splitSlackText('  short  ')).toEqual(['short'])
    expect(splitSlackText('')).toEqual([])
  })
})
