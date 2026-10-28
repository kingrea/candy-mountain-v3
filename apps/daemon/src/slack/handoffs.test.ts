import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listActivityEvents } from '../activity'
import { CLAUDE_FIXTURE, fakeBins } from '../acp/test-support'
import { createBot, parseCreateBot, recordBotPersonaCheck, type BotReadDeps } from '../bots'
import { pluginInstances, slackTurns } from '../db/schema'
import { createPluginInstance } from '../plugins/instances/instances'
import { GOOD_TOKEN, stubHosts } from '../plugins/repository/fake-hosts'
import { createSlackClient, createSlackOperations } from '../plugins/slack'
import { createProject } from '../projects/projects'
import { startPlatform, type Platform } from '../platform'
import { MasterKey } from '../secrets'
import { addTeamMember } from '../team'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createTempGitRepo, type TempGitRepo } from '../worktrees/test-repo'
import { createSlackEventBus, type SlackEventBus, type SlackInteractiveBotEvent, type SlackMessageBotEvent } from './events'
import { SLACK_HANDOFF_DONE_ACTION, issueShortId, slackHandoffMessage } from './handoff-message'
import { startSlackHandoffs, type SlackHandoffs } from './handoffs'
import { startSlackRouter, type SlackRouter, type SlackTurnEnd } from './router'
import { findSlackThread } from './threads'

const CLAUDE_PERSONA = '---\nname: ana\ndescription: Ana fixes small issues.\n---\nYou are Ana. Keep changes small.\n'
const JACK = 'U0JACK'
const BOT_USER = 'U0BOT'
const HANDOFF = 'Fixed the login redirect.\n\n```handoff\noutcome: done\nsummary: Fixed the login redirect loop\npull_request: https://github.com/jack/candy/pull/42\nissues: candy-mountain-v3-x8m.7.6, cm-abc\nfollow_ups: add a test for SSO; tidy the docs\n```'

let temp: TempDataDir | undefined
let platform: Platform | undefined
let repo: TempGitRepo | undefined
let router: SlackRouter | undefined
let handoffs: SlackHandoffs | undefined

afterEach(async () => {
  router?.close()
  router = undefined
  handoffs?.close()
  handoffs = undefined
  await platform?.sessions.close()
  platform?.close()
  platform = undefined
  temp?.cleanup()
  temp = undefined
  repo?.cleanup()
  repo = undefined
  vi.unstubAllGlobals()
})

/** The claude fixture fed only the Slack message, so the agent's reply is exactly what the member wrote. */
function slackClaude(dir: string): string {
  const filter = join(dir, 'slack-claude.mjs')
  writeFileSync(filter, `
import { spawn } from 'node:child_process'
import readline from 'node:readline'
const child = spawn(process.execPath, [${JSON.stringify(CLAUDE_FIXTURE)}, ...process.argv.slice(2)], { stdio: ['pipe', 'inherit', 'inherit'] })
child.on('exit', code => process.exit(code ?? 0))
for await (const line of readline.createInterface({ input: process.stdin })) {
  const value = JSON.parse(line)
  const block = value.type === 'user' ? value.message?.content?.[0] : null
  const match = typeof block?.text === 'string' ? block.text.match(/\\nmessage:\\n([\\s\\S]*)\\n<\\/slack-(?:request|reply)>$/) : null
  if (match) block.text = match[1]
  child.stdin.write(JSON.stringify(value) + '\\n')
}
child.stdin.end()
`)
  const path = join(dir, 'claude')
  writeFileSync(path, `#!/bin/sh\nexec '${process.execPath}' '${filter}' "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

interface SlackCall { method: string, body: Record<string, unknown> }

function fakeTransport() {
  const bus: SlackEventBus = createSlackEventBus({ error: () => {} })
  const calls: SlackCall[] = []
  let posted = 0
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const method = String(url).replace('https://slack.com/api/', '')
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ method, body })
    const reply = method === 'chat.postMessage' || method === 'chat.startStream'
      ? { ok: true, channel: body.channel, ts: `9.${++posted}` }
      : method === 'chat.getPermalink'
        ? { ok: true, channel: body.channel, permalink: `https://candy.slack.com/archives/${String(body.channel)}/p${String(body.message_ts).replace('.', '')}` }
        : { ok: true }
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const slack = {
    subscribe: bus.subscribe,
    web: () => ({ client: createSlackClient('xoxb-test', { fetch }), operations: createSlackOperations({}, { get: () => 'xoxb-test' }, { fetch }) }),
  }
  const of = (method: string) => calls.filter(call => call.method === method).map(call => call.body)
  return { bus, slack, calls, of }
}

let eventCounter = 0

function mention(botId: string, projectId: string, text: string, ts = '1.1'): SlackMessageBotEvent {
  const event = { channel: 'C01LISTED', channelType: 'channel', user: JACK, senderBotId: null, subtype: null, text: `<@${BOT_USER}> ${text}`, ts, threadTs: null, raw: {} }
  return { kind: 'app_mention', botId, projectId, envelopeId: `env-${++eventCounter}`, retryAttempt: 0, retryReason: null, receivedAt: new Date().toISOString(), botUserId: BOT_USER, eventId: `Ev${eventCounter}`, teamId: 'T0CANDY', fromSelf: false, event }
}

function press(botId: string, projectId: string, messageTs: string, turnId: string, user = JACK): SlackInteractiveBotEvent {
  return {
    kind: 'interactive',
    botId,
    projectId,
    envelopeId: `env-${++eventCounter}`,
    retryAttempt: 0,
    retryReason: null,
    receivedAt: new Date().toISOString(),
    botUserId: BOT_USER,
    interaction: { type: 'block_actions', userId: user, channelId: 'C01LISTED', messageTs, threadTs: '1.1', actions: [{ actionId: SLACK_HANDOFF_DONE_ACTION, blockId: null, type: 'button', value: turnId }], responseUrl: null, triggerId: null, raw: {} },
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

async function setup() {
  repo = createTempGitRepo()
  commitFile('.claude/agents/ana.md', CLAUDE_PERSONA)
  stubHosts()
  temp = createTempDataDir()
  const p = platform = startPlatform(temp.root, { secretsKey: MasterKey.generate(), acp: { bins: fakeBins, killTimeoutMs: 1000 } })
  const project = await createProject(p.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: repo.clone } })
  setHealth(p, project.id, 'repository', { host: 'github', owner: 'jack', repo: 'candy' }, { token: GOOD_TOKEN })
  setHealth(p, project.id, 'claude-code', { claudePath: slackClaude(temp.root) })
  const bot = await createBot(readDeps(p), project.id, parseCreateBot({ name: 'Ana Bot', family: 'claude-code', writeScope: 'write-confirm', personaName: 'ana', answersIn: { channels: ['C01LISTED'] } }))
  expect(recordBotPersonaCheck(p.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(true)
  addTeamMember(p.db, project.id, { displayName: 'Jack', email: null, slackMemberId: JACK, botScope: { all: true } })

  const transport = fakeTransport()
  const ends: SlackTurnEnd[] = []
  handoffs = startSlackHandoffs({ db: p.db, slack: transport.slack, botSessions: p.botSessions, sessions: p.sessions }, { log: { error: () => {} } })
  const hook = handoffs.onTurnEnd
  router = startSlackRouter({ db: p.db, slack: transport.slack, botSessions: p.botSessions, sessions: p.sessions }, { log: { error: () => {} }, streamIntervalMs: 50, onTurnEnd: async (end) => {
    ends.push(end)
    await hook(end)
  } })
  const thread = () => findSlackThread(p.db, { botId: bot.id, channelId: 'C01LISTED', threadTs: '1.1' })!
  const handoffEvents = () => listActivityEvents(p.db, project.id, { types: ['bot.handoff'] }).events
  return { p, project, bot, ...transport, router, handoffs, ends, thread, handoffEvents }
}

describe('slackHandoffMessage', () => {
  const handoff = { outcome: 'partial' as const, summary: 'Half of <it> & more', pullRequest: 'https://gitlab.com/a/b/-/merge_requests/7', issues: ['proj-x1', 'X2'], followUps: ['one', 'two <!channel>'] }

  it('lays out the prose, outcome, links, short ids, follow-ups and the button', () => {
    const { text, blocks } = slackHandoffMessage({ handoff, prose: '\nDid the first half.\n', turnId: 'turn-1', closed: null })
    expect(text).toBe('Partly done: Half of &lt;it&gt; &amp; more')
    expect(blocks.map(block => block.type)).toEqual(['markdown', 'divider', 'section', 'section', 'section', 'actions'])
    expect(blocks[0]).toEqual({ type: 'markdown', text: 'Did the first half.' })
    expect(blocks[2]).toEqual({ type: 'section', text: { type: 'mrkdwn', text: ':large_yellow_circle: *Partly done*\nHalf of &lt;it&gt; &amp; more' } })
    expect(blocks[3]).toEqual({ type: 'section', fields: [{ type: 'mrkdwn', text: '*Pull request*\n<https://gitlab.com/a/b/-/merge_requests/7|#7>' }, { type: 'mrkdwn', text: '*Issues*\n`X1`, `X2`' }] })
    expect(blocks[4]).toEqual({ type: 'section', text: { type: 'mrkdwn', text: '*Follow-ups*\n• one\n• two &lt;!channel&gt;' } })
    expect(blocks[5]).toMatchObject({ type: 'actions', elements: [{ type: 'button', action_id: SLACK_HANDOFF_DONE_ACTION, value: 'turn-1', style: 'primary' }] })
  })

  it('drops empty parts and shows who closed the session instead of the button', () => {
    const bare = { outcome: 'blocked' as const, summary: 'Stuck', pullRequest: 'not a url', issues: [], followUps: [] }
    const { blocks } = slackHandoffMessage({ handoff: bare, prose: '  ', turnId: 'turn-1', closed: { by: JACK } })
    expect(blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: ':no_entry: *Blocked*\nStuck' } },
      { type: 'section', fields: [{ type: 'mrkdwn', text: '*Pull request*\nnot a url' }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Marked done by <@${JACK}>.` }] },
    ])
    expect(slackHandoffMessage({ handoff: bare, prose: '', turnId: null, closed: null }).blocks.some(block => block.type === 'actions')).toBe(false)
  })

  it('shortens issue ids the way the issues list does', () => {
    expect(issueShortId('candy-mountain-v3-x8m.7.6')).toBe('X8M.7.6')
    expect(issueShortId('abc')).toBe('ABC')
  })
})

describe('Slack handoffs', () => {
  it('turns the streamed message into a card and records one bot.handoff event, however often the hook runs', async () => {
    const t = await setup()
    t.bus.emit(mention(t.bot.id, t.project.id, HANDOFF))
    await t.router.idle()

    const turn = t.p.db.select().from(slackTurns).get()!
    const update = t.of('chat.update').at(-1)!
    expect(update).toMatchObject({ channel: 'C01LISTED', ts: '9.1', text: 'Done: Fixed the login redirect loop' })
    const blocks = update.blocks as Record<string, unknown>[]
    expect(blocks[0]).toEqual({ type: 'markdown', text: 'Fixed the login redirect.' })
    expect(JSON.stringify(blocks)).toContain('<https://github.com/jack/candy/pull/42|#42>')
    expect(JSON.stringify(blocks)).toContain('`X8M.7.6`, `ABC`')
    expect(JSON.stringify(blocks)).toContain('• add a test for SSO\\n• tidy the docs')
    expect(blocks.at(-1)).toMatchObject({ type: 'actions', elements: [{ action_id: SLACK_HANDOFF_DONE_ACTION, value: turn.id }] })

    const events = t.handoffEvents()
    expect(events).toEqual([expect.objectContaining({
      type: 'bot.handoff',
      title: 'Ana Bot: Fixed the login redirect loop',
      link: 'https://candy.slack.com/archives/C01LISTED/p91',
      payload: expect.objectContaining({ turnId: turn.id, sessionId: t.thread().sessionId, outcome: 'done', turnOutcome: 'completed', pullRequest: 'https://github.com/jack/candy/pull/42', issueIds: ['candy-mountain-v3-x8m.7.6', 'cm-abc'], followUps: ['add a test for SSO', 'tidy the docs'] }),
    })])
    expect(turn.state).toBe('completed')

    // At least once: a rerun edits the same message to the same card and records nothing new.
    const updates = t.of('chat.update').length
    const posts = t.of('chat.postMessage').length
    await t.handoffs.onTurnEnd(t.ends[0]!)
    expect(t.of('chat.update')).toHaveLength(updates + 1)
    expect(t.of('chat.update').at(-1)).toEqual(update)
    expect(t.of('chat.postMessage')).toHaveLength(posts)
    expect(t.handoffEvents()).toHaveLength(1)
  }, 60_000)

  it('leaves the raw text when the handoff block is missing or malformed, and still records the event', async () => {
    const t = await setup()
    t.bus.emit(mention(t.bot.id, t.project.id, 'All good, nothing to change.'))
    await t.router.idle()
    t.bus.emit(mention(t.bot.id, t.project.id, '```handoff\noutcome: maybe\nsummary: x\n```\nLooked, unsure.', '1.2'))
    await t.router.idle()

    expect(t.calls.filter(call => call.body.blocks !== undefined)).toEqual([])
    expect(t.handoffEvents().map(event => [event.title, event.payload?.outcome, event.link])).toEqual([
      ['Ana Bot: Looked, unsure.', null, 'https://candy.slack.com/archives/C01LISTED/p92'],
      ['Ana Bot: All good, nothing to change.', null, 'https://candy.slack.com/archives/C01LISTED/p91'],
    ])
  }, 60_000)

  it('mark done closes the session like the done verb, releases the worktree and shows who pressed it', async () => {
    const t = await setup()
    addTeamMember(t.p.db, t.project.id, { displayName: 'Ann', email: null, slackMemberId: 'U0ANN', botScope: { botIds: [] } })
    t.bus.emit(mention(t.bot.id, t.project.id, HANDOFF))
    await t.router.idle()
    const turn = t.p.db.select().from(slackTurns).get()!
    const lease = t.p.botSessions.lease(turn.sessionId)!
    expect(lease.state).toBe('active')
    const calls = t.calls.length

    // A member who may not talk to the bot cannot close its session either.
    t.bus.emit(press(t.bot.id, t.project.id, '9.1', turn.id, 'U0ANN'))
    await t.handoffs.idle()
    expect(t.calls).toHaveLength(calls)
    expect(t.thread().state).toBe('open')

    t.bus.emit(press(t.bot.id, t.project.id, '9.1', turn.id))
    await t.handoffs.idle()
    expect(t.thread().state).toBe('closed')
    expect(t.p.botSessions.lease(turn.sessionId)).toMatchObject({ state: 'released' })
    expect(existsSync(lease.path)).toBe(false)
    const done = () => t.of('chat.postMessage').filter(body => String(body.text).startsWith('Done.'))
    expect(done()).toEqual([{ channel: 'C01LISTED', thread_ts: '1.1', text: `Done. The worktree was released; branch \`${lease.branch}\` is kept.` }])
    const closed = t.of('chat.update').at(-1)!
    expect(closed).toMatchObject({ channel: 'C01LISTED', ts: '9.1' })
    expect((closed.blocks as Record<string, unknown>[]).at(-1)).toEqual({ type: 'context', elements: [{ type: 'mrkdwn', text: `Marked done by <@${JACK}>.` }] })

    // Slack redelivers envelopes: a second press closes nothing and posts nothing.
    t.bus.emit(press(t.bot.id, t.project.id, '9.1', turn.id))
    await t.handoffs.idle()
    expect(done()).toHaveLength(1)
    expect((t.of('chat.update').at(-1)!.blocks as Record<string, unknown>[]).at(-1)).toEqual({ type: 'context', elements: [{ type: 'mrkdwn', text: 'The session is closed.' }] })
  }, 60_000)
})
