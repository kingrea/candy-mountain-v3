import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLAUDE_FIXTURE, fakeBins } from '../acp/test-support'
import { createBot, parseCreateBot, recordBotPersonaCheck, type BotReadDeps } from '../bots'
import { pluginInstances, slackTurns } from '../db/schema'
import { createPluginInstance } from '../plugins/instances/instances'
import { GOOD_TOKEN, stubHosts } from '../plugins/repository/fake-hosts'
import { createSlackClient, createSlackOperations } from '../plugins/slack'
import { createProject } from '../projects/projects'
import { startAcpPlatform, type AcpPlatform } from '../chat-claude-code/test-support'
import { MasterKey } from '../secrets'
import { addTeamMember } from '../team'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createTempGitRepo, type TempGitRepo } from '../worktrees/test-repo'
import { createSlackEventBus, type SlackEventBus, type SlackMessageBotEvent } from './events'
import { startSlackRouter, type SlackRouter, type SlackRouterOptions, type SlackTurnEnd } from './router'
import { findSlackThread } from './threads'

const CLAUDE_PERSONA = '---\nname: ana\ndescription: Ana fixes small issues.\n---\nYou are Ana. Keep changes small.\n'
const JACK = 'U0JACK'
const BOT_USER = 'U0BOT'

let temp: TempDataDir | undefined
let platform: AcpPlatform | undefined
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

/**
 * The claude fixture behind a filter that hands it only the Slack message, so a message can name a fixture scenario.
 * Three scenarios of its own: `slow` streams a tool call and text over ~600ms, `hang` does the same and never ends the turn,
 * `gated` holds the tool result until the file `gate` appears beside the filter, so a test can see the call in flight.
 */
function slackClaude(dir: string): string {
  const filter = join(dir, 'slack-claude.mjs')
  writeFileSync(filter, `
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import readline from 'node:readline'
const args = process.argv.slice(2)
const id = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1]
const child = spawn(process.execPath, [${JSON.stringify(CLAUDE_FIXTURE)}, ...args], { stdio: ['pipe', 'inherit', 'inherit'] })
child.on('exit', code => process.exit(code ?? 0))
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const text = (index, value) => [
  { type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } } },
  { type: 'stream_event', event: { type: 'content_block_stop', index } },
]
const gate = ${JSON.stringify(join(dir, 'gate'))}
async function work(ending, gated) {
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } })
  for (const line of text(0, 'Looking around. ')) emit(line)
  await sleep(200)
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolcall1', name: 'Bash', input: {} } } })
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' } } })
  emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 1 } })
  if (gated) while (!existsSync(gate)) await sleep(10)
  else await sleep(200)
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolcall1', content: [{ type: 'text', text: 'file1' }] }] } })
  for (const line of text(2, 'Found file1.')) emit(line)
  if (!ending) return
  await sleep(200)
  emit({ type: 'assistant', session_id: id, message: { id: 'm1', content: [{ type: 'text', text: 'Looking around. ' }, { type: 'tool_use', id: 'toolcall1', name: 'Bash', input: { command: 'ls' } }, { type: 'text', text: 'Found file1.' }] } })
  emit({ type: 'result', subtype: 'success', session_id: id, result: 'Found file1.' })
}
for await (const line of readline.createInterface({ input: process.stdin })) {
  const value = JSON.parse(line)
  const block = value.type === 'user' ? value.message?.content?.[0] : null
  const match = typeof block?.text === 'string' ? block.text.match(/\\nmessage:\\n([\\s\\S]*)\\n<\\/slack-(?:request|reply)>$/) : null
  if (match?.[1] === 'slow') { void work(true); continue }
  if (match?.[1] === 'gated') { void work(true, true); continue }
  if (match?.[1] === 'hang') { void work(false); continue }
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

/** Slack's Web API as far as the router uses it; `stream: false` refuses chat.startStream, `expired` answers for a stream past Slack's 10 minutes. */
function fakeTransport(input: { stream: boolean, expired?: boolean }) {
  const bus: SlackEventBus = createSlackEventBus({ error: () => {} })
  const calls: SlackCall[] = []
  // Final text per message ts: a turn that flushed before it ended is edited in place, so only the settled text is stable.
  const texts = new Map<string, string>()
  let posted = 0
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const method = String(url).replace('https://slack.com/api/', '')
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ method, body })
    if (method === 'chat.update') texts.set(String(body.ts), String(body.text))
    if (method === 'chat.postMessage') texts.set(`9.${posted + 1}`, String(body.text))
    const reply = method === 'chat.postMessage' || (method === 'chat.startStream' && input.stream)
      ? { ok: true, channel: body.channel, ts: `9.${++posted}` }
      : method === 'chat.startStream'
        ? { ok: false, error: 'not_allowed_token_type' }
        : input.expired && (method === 'chat.appendStream' || method === 'chat.stopStream') ? { ok: false, error: 'message_not_in_streaming_state' } : { ok: true }
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const slack = {
    subscribe: bus.subscribe,
    web: () => ({ client: createSlackClient('xoxb-test', { fetch }), operations: createSlackOperations({}, { get: () => 'xoxb-test' }, { fetch }) }),
  }
  const of = (method: string) => calls.filter(call => call.method === method).map(call => call.body)
  /** Calls that create a message in the thread, which exactly-once is about. */
  const created = () => calls.filter(call => call.method === 'chat.postMessage' || call.method === 'chat.startStream')
  return { bus, slack, calls, of, created, texts }
}

let eventCounter = 0

function messageEvent(botId: string, projectId: string, input: { kind?: 'app_mention' | 'message', text: string, ts: string, threadTs?: string | null }): SlackMessageBotEvent {
  const event = { channel: 'C01LISTED', channelType: 'channel', user: JACK, senderBotId: null, subtype: null, text: input.text, ts: input.ts, threadTs: input.threadTs ?? null, raw: {} }
  return { kind: input.kind ?? 'app_mention', botId, projectId, envelopeId: `env-${++eventCounter}`, retryAttempt: 0, retryReason: null, receivedAt: new Date().toISOString(), botUserId: BOT_USER, eventId: `Ev${eventCounter}`, teamId: 'T0CANDY', fromSelf: false, event }
}

function commitFile(path: string, text: string): void {
  const file = join(repo!.clone, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  repo!.git(repo!.clone, 'add', path)
  repo!.git(repo!.clone, 'commit', '--quiet', '-m', `add ${path}`)
  repo!.git(repo!.clone, 'push', '--quiet', 'origin', 'main')
}

function setHealth(p: AcpPlatform, projectId: string, type: 'repository' | 'claude-code', config: Record<string, unknown> = {}, secrets: Record<string, string> = {}): void {
  const existing = p.db.select().from(pluginInstances).where(eq(pluginInstances.projectId, projectId)).all().find(row => row.typeId === type)
  const id = existing?.id ?? createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type, scope: 'project', projectId, config, secrets }).id
  p.db.update(pluginInstances).set({ health: { healthy: true }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, id)).run()
}

const readDeps = (p: AcpPlatform): BotReadDeps => ({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets })

function boot(dataDir: string, key: MasterKey): AcpPlatform {
  platform = startAcpPlatform(dataDir, { secretsKey: key, acp: { bins: fakeBins, killTimeoutMs: 1000 } })
  return platform
}

function route(p: AcpPlatform, input: { stream: boolean, expired?: boolean }, options: SlackRouterOptions = {}) {
  const transport = fakeTransport(input)
  router = startSlackRouter({ db: p.db, slack: transport.slack, botSessions: p.botSessions, sessions: p.sessions }, { log: { error: () => {} }, streamIntervalMs: 50, ...options })
  return { ...transport, router }
}

async function setup() {
  repo = createTempGitRepo()
  commitFile('.claude/agents/ana.md', CLAUDE_PERSONA)
  stubHosts()
  temp = createTempDataDir()
  const key = MasterKey.generate()
  const p = boot(temp.root, key)
  const project = await createProject(p.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: repo.clone } })
  setHealth(p, project.id, 'repository', { host: 'github', owner: 'jack', repo: 'candy' }, { token: GOOD_TOKEN })
  setHealth(p, project.id, 'claude-code', { claudePath: slackClaude(temp.root) })
  const bot = await createBot(readDeps(p), project.id, parseCreateBot({ name: 'Ana Bot', family: 'claude-code', writeScope: 'write-confirm', personaName: 'ana', answersIn: { channels: ['C01LISTED'] } }))
  expect(recordBotPersonaCheck(p.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(true)
  addTeamMember(p.db, project.id, { displayName: 'Jack', email: null, slackMemberId: JACK, botScope: { all: true } })
  return { p, project, bot, key }
}

async function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

describe('Slack turn progress', () => {
  it('streams text and tool summaries into one native stream and stops it at the end of the turn', async () => {
    const { p, project, bot } = await setup()
    const ends: SlackTurnEnd[] = []
    const t = route(p, { stream: true }, { onTurnEnd: end => void ends.push(end) })
    t.bus.emit(messageEvent(bot.id, project.id, { text: `<@${BOT_USER}> slow`, ts: '1.1' }))
    await t.router.idle()

    expect(t.created().map(call => call.method)).toEqual(['chat.startStream'])
    expect(t.of('chat.startStream')[0]).toMatchObject({ channel: 'C01LISTED', thread_ts: '1.1', recipient_user_id: JACK, recipient_team_id: 'T0CANDY', chunks: [{ type: 'markdown_text', text: 'Looking around. ' }] })
    const chunks = t.of('chat.appendStream').flatMap(body => body.chunks as Record<string, unknown>[])
    expect(t.of('chat.appendStream').every(body => body.ts === '9.1')).toBe(true)
    expect(chunks).toContainEqual({ type: 'task_update', id: 'toolcall1', title: 'Bash: ls', status: 'in_progress' })
    expect(chunks).toContainEqual({ type: 'task_update', id: 'toolcall1', title: 'Bash: ls', status: 'complete' })
    const streamedText = [...t.of('chat.startStream'), ...t.of('chat.appendStream'), ...t.of('chat.stopStream')]
      .flatMap(body => (body.chunks as { type: string, text?: string }[] | undefined) ?? []).filter(chunk => chunk.type === 'markdown_text').map(chunk => chunk.text).join('')
    expect(streamedText).toBe('Looking around. Found file1.')
    expect(t.of('chat.stopStream')).toEqual([expect.objectContaining({ channel: 'C01LISTED', ts: '9.1' })])
    expect(t.calls.at(-1)!.method).toBe('chat.stopStream')

    const thread = findSlackThread(p.db, { botId: bot.id, channelId: 'C01LISTED', threadTs: '1.1' })!
    expect(p.db.select().from(slackTurns).all()).toEqual([expect.objectContaining({ threadId: thread.id, mode: 'stream', messageTs: '9.1', state: 'completed', resumes: 0 })])
    expect(ends).toEqual([expect.objectContaining({ sessionId: thread.sessionId, outcome: 'completed', text: 'Looking around. Found file1.', message: { channel: 'C01LISTED', threadTs: '1.1', ts: '9.1', mode: 'stream' } })])
  }, 60_000)

  it('falls back to one message edited in place when the workspace cannot stream', async () => {
    const { p, project, bot } = await setup()
    const t = route(p, { stream: false })
    t.bus.emit(messageEvent(bot.id, project.id, { text: `<@${BOT_USER}> gated`, ts: '1.1' }))
    await waitFor(() => t.of('chat.update').some(body => String(body.text).includes('… Bash: ls')))
    writeFileSync(join(temp!.root, 'gate'), '')
    await t.router.idle()

    expect(t.of('chat.startStream')).toHaveLength(1)
    expect(t.of('chat.postMessage')).toEqual([expect.objectContaining({ channel: 'C01LISTED', thread_ts: '1.1', text: expect.stringContaining('_Working…_') })])
    const updates = t.of('chat.update')
    expect(updates.length).toBeGreaterThanOrEqual(2)
    expect(updates.every(body => body.ts === '9.1')).toBe(true)
    expect(updates.some(body => String(body.text).includes('… Bash: ls'))).toBe(true)
    expect(updates.at(-1)!.text).toBe('✓ Bash: ls\n\nLooking around. Found file1.')
    expect(p.db.select().from(slackTurns).all()).toEqual([expect.objectContaining({ mode: 'message', messageTs: '9.1', state: 'completed' })])

    // The refusal is remembered, so the next turn goes straight to a message.
    t.bus.emit(messageEvent(bot.id, project.id, { kind: 'message', text: 'again', ts: '1.2', threadTs: '1.1' }))
    await t.router.idle()
    expect(t.of('chat.startStream')).toHaveLength(1)
    expect(t.of('chat.postMessage').at(-1)).toMatchObject({ thread_ts: '1.1' })
    expect(t.texts.get('9.2')).toBe('again')
  }, 60_000)

  it('finishes a turn interrupted by a restart exactly once, in the message it started', async () => {
    const { p: first, project, bot, key } = await setup()
    const before = route(first, { stream: true })
    before.bus.emit(messageEvent(bot.id, project.id, { text: `<@${BOT_USER}> hang`, ts: '1.1' }))
    const thread = () => findSlackThread(first.db, { botId: bot.id, channelId: 'C01LISTED', threadTs: '1.1' })
    await waitFor(() => {
      const turn = first.db.select().from(slackTurns).get()
      return turn !== undefined && first.sessions.events(turn.sessionId).some(e => e.kind === 'text' && e.text === 'Found file1.' && e.seq <= turn.sentSeq)
    })
    const { sessionId } = thread()!
    expect(before.created().map(call => call.method)).toEqual(['chat.startStream'])
    before.router.close()
    await first.sessions.close()
    first.close()

    const p = boot(temp!.root, key)
    expect(p.db.select().from(slackTurns).all()).toEqual([expect.objectContaining({ state: 'open', mode: 'stream', messageTs: '9.1', resumes: 0 })])
    const after = route(p, { stream: true })
    await after.router.idle()

    // The agent was asked to carry on, and what it said went into the same stream.
    expect(after.created()).toEqual([])
    const prompts = p.sessions.events(sessionId).filter(e => e.kind === 'prompt')
    expect(prompts).toHaveLength(2)
    expect(after.of('chat.stopStream')).toEqual([expect.objectContaining({ ts: '9.1' })])
    const resumed = [...after.of('chat.appendStream'), ...after.of('chat.stopStream')].flatMap(body => (body.chunks as { text?: string }[] | undefined) ?? []).map(chunk => chunk.text ?? '').join('')
    expect(resumed).toContain('<slack-resume>')
    expect(resumed).not.toContain('Looking around.')
    expect(p.db.select().from(slackTurns).all()).toEqual([expect.objectContaining({ state: 'completed', mode: 'stream', messageTs: '9.1', resumes: 1 })])

    // A later boot has nothing left to finish.
    after.router.close()
    const again = route(p, { stream: true })
    await again.router.idle()
    expect(again.calls).toEqual([])
  }, 90_000)

  it('edits the same message when the stream ended while the daemon was down', async () => {
    const { p: first, project, bot, key } = await setup()
    const before = route(first, { stream: true })
    before.bus.emit(messageEvent(bot.id, project.id, { text: `<@${BOT_USER}> hang`, ts: '1.1' }))
    await waitFor(() => {
      const turn = first.db.select().from(slackTurns).get()
      return turn !== undefined && first.sessions.events(turn.sessionId).some(e => e.kind === 'text' && e.text === 'Found file1.' && e.seq <= turn.sentSeq)
    })
    before.router.close()
    await first.sessions.close()
    first.close()

    const p = boot(temp!.root, key)
    const after = route(p, { stream: true, expired: true })
    await after.router.idle()
    expect(after.created()).toEqual([])
    const final = after.of('chat.update').at(-1)!
    expect(final).toMatchObject({ channel: 'C01LISTED', ts: '9.1' })
    expect(String(final.text)).toMatch(/^✓ Bash: ls\n\nLooking around. Found file1.<slack-resume>/)
    expect(p.db.select().from(slackTurns).all()).toEqual([expect.objectContaining({ state: 'completed', mode: 'message', messageTs: '9.1' })])
  }, 90_000)

  it('runs the turn-end hook again after a restart that cut it off, without touching the message', async () => {
    const { p: first, project, bot, key } = await setup()
    const before = route(first, { stream: true }, { onTurnEnd: () => new Promise(() => {}) })
    before.bus.emit(messageEvent(bot.id, project.id, { text: `<@${BOT_USER}> slow`, ts: '1.1' }))
    await waitFor(() => first.db.select().from(slackTurns).get()?.state === 'finished')
    before.router.close()
    await first.sessions.close()
    first.close()

    const p = boot(temp!.root, key)
    const ends: SlackTurnEnd[] = []
    const after = route(p, { stream: true }, { onTurnEnd: end => void ends.push(end) })
    await after.router.idle()
    const turn = p.db.select().from(slackTurns).get()!
    expect(ends).toEqual([expect.objectContaining({ turnId: turn.id, outcome: 'completed', text: 'Looking around. Found file1.', message: { channel: 'C01LISTED', threadTs: '1.1', ts: '9.1', mode: 'stream' } })])
    expect(after.calls).toEqual([])
    expect(turn.state).toBe('completed')
  }, 90_000)
})
