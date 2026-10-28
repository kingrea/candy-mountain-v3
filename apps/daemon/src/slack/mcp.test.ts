import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BOT_WRITE_SCOPES } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFamilyLaunch, type LaunchMcpServer } from '../acp'
import { fakeBins } from '../acp/test-support'
import { claudeMcpToolRule, SLACK_POST_BLOCKS_TOOL, startAgentMcpHost, type AgentMcpHost } from '../agent-mcp'
import { createBot, parseCreateBot, recordBotPersonaCheck, type BotReadDeps } from '../bots'
import { pluginInstances } from '../db/schema'
import { createPluginInstance } from '../plugins/instances/instances'
import { GOOD_TOKEN, stubHosts } from '../plugins/repository/fake-hosts'
import { createSlackClient, createSlackOperations } from '../plugins/slack'
import { assertPostureNotWidened, PostureError, resolveBotPosture } from '../posture'
import { createProject } from '../projects/projects'
import { startPlatform, type Platform } from '../platform'
import { MasterKey } from '../secrets'
import { addTeamMember } from '../team'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createTempGitRepo, type TempGitRepo } from '../worktrees/test-repo'
import { SLACK_RESERVED_ID_PREFIX, validateSlackBlocksPost } from './block-kit'
import { SLACK_DECISION_ACTION } from './decision-message'
import { createSlackEventBus, type SlackEventBus, type SlackMessageBotEvent } from './events'
import { slackMcpServer } from './mcp'
import { startSlackRouter, type SlackRouter } from './router'
import { findSlackThread } from './threads'

const TARGET = { channel: 'C01LISTED', threadTs: '1.1' }
const SECTION = { type: 'section', text: { type: 'mrkdwn', text: '*Build* passed' } }
const RULE = claudeMcpToolRule(SLACK_POST_BLOCKS_TOOL)

describe('Block Kit validation', () => {
  it('accepts well-formed blocks and pins the post to the thread', () => {
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: 'Release' } },
      SECTION,
      { type: 'divider' },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'by Ana' }] },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open PR' }, url: 'https://github.com/x/y/pull/1', action_id: 'open-pr' }] },
    ]
    expect(validateSlackBlocksPost({ text: 'Release', blocks, channel: 'C01LISTED', thread_ts: '1.1' }, TARGET)).toEqual({ ok: true, post: { channel: 'C01LISTED', thread_ts: '1.1', text: 'Release', blocks } })
    expect(validateSlackBlocksPost({ text: 'x', blocks: [SECTION] }, TARGET)).toMatchObject({ ok: true, post: { channel: 'C01LISTED', thread_ts: '1.1' } })
  })

  it('refuses anything outside the thread, malformed blocks, oversize payloads and tokens', () => {
    const refused = (input: Record<string, unknown>) => {
      const result = validateSlackBlocksPost({ text: 'fallback', blocks: [SECTION], ...input }, TARGET)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      return result.ok ? '' : result.reason
    }
    expect(refused({ channel: 'C02OTHER' })).toContain('channel "C02OTHER"')
    expect(refused({ thread_ts: '9.9' })).toContain('thread "9.9"')
    expect(refused({ reply_broadcast: true })).toContain('reply_broadcast')
    expect(refused({ as_user: true, username: 'Jack' })).toContain('as_user, username')
    expect(refused({ text: '' })).toContain('text is required')
    expect(refused({ text: 'x'.repeat(3001) })).toContain('longer than')
    expect(refused({ blocks: [] })).toContain('1 to 50')
    expect(refused({ blocks: Array.from({ length: 51 }, () => SECTION) })).toContain('1 to 50')
    expect(refused({ blocks: Array.from({ length: 40 }, () => ({ type: 'markdown', text: 'y'.repeat(1000) })) })).toContain('larger than')
    expect(refused({ blocks: ['section'] })).toContain('must be an object')
    expect(refused({ blocks: [{ type: 'input', element: {} }] })).toContain('type must be one of')
    expect(refused({ blocks: [{ type: 'section' }] })).toContain('needs text or fields')
    expect(refused({ blocks: [{ type: 'header', text: { type: 'mrkdwn', text: 'x' } }] })).toContain('plain_text')
    expect(refused({ blocks: [{ type: 'image', image_url: 'https://x.test/a.png' }] })).toContain('alt_text')
    expect(refused({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'token xoxb-1234-5678-abcdef' } }] })).toContain('credential')
    expect(refused({ text: 'key xapp-1-A0-123456789' })).toContain('credential')
    expect(refused({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'ghp_' + 'a'.repeat(36) } }] })).toContain('credential')
    expect(refused({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hey <!channel>' } }] })).toContain('whole channel')
    expect(refused({ blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'broadcast', range: 'here' }] }] }] })).toContain('whole channel')
    expect(refused({ blocks: [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Allow' }, action_id: `${SLACK_DECISION_ACTION}:1`, value: 'x:1' }] }] })).toContain('reserved')
    expect(SLACK_DECISION_ACTION.startsWith(SLACK_RESERVED_ID_PREFIX)).toBe(true)
  })
})

describe('Posture for the Block Kit tool', () => {
  const persona = '---\nname: pip\ndescription: Fixes small issues\n---\nYou are Pip.'
  const resolve = (writeScope: (typeof BOT_WRITE_SCOPES)[number], mcpTools = [SLACK_POST_BLOCKS_TOOL]) =>
    resolveBotPosture({ family: 'claude-code', writeScope, personaName: 'pip', personaText: persona, checkoutDir: '/work/alpha', checkoutSettings: [], mcpTools })
  const allowed = (flags: string[]) => flags[flags.indexOf('--allowedTools') + 1]!.split(',')

  it('allows exactly the one tool in every write scope and still passes the widening check', () => {
    for (const scope of BOT_WRITE_SCOPES) {
      const posture = resolve(scope)
      expect(allowed(posture.flags)).toEqual(['Bash(bd *)', RULE])
      expect(posture.flags).toContain('--strict-mcp-config')
      expect(posture.flags).not.toContain('--mcp-config')
      expect(() => assertPostureNotWidened(posture, scope)).not.toThrow()
      expect(allowed(resolve(scope, []).flags)).toEqual(['Bash(bd *)'])
    }
  })

  it('refuses other MCP allow rules, unknown tools and an MCP config in the stored flags', () => {
    const posture = resolve('write-confirm')
    const swap = (from: string, to: string) => ({ ...posture, flags: posture.flags.map(flag => flag.split(from).join(to)) })
    expect(() => assertPostureNotWidened(swap(RULE, 'mcp__github__create_pull_request'), 'write-confirm')).toThrow(/Only daemon-hosted MCP tools/)
    expect(() => assertPostureNotWidened(swap(RULE, 'mcp__candy_mountain_slack'), 'write-confirm')).toThrow(/Only daemon-hosted MCP tools/)
    expect(() => assertPostureNotWidened({ ...posture, flags: [...posture.flags, '--mcp-config', '{"mcpServers":{}}'] }, 'write-confirm')).toThrow(/--mcp-config is refused/)
    expect(() => resolve('write-confirm', [{ server: 'github', tool: 'merge' } as never])).toThrow(PostureError)
  })
})

describe('MCP registration at launch', () => {
  const server: LaunchMcpServer = { name: 'candy_mountain_slack', url: 'http://127.0.0.1:4555/mcp/candy_mountain_slack/s1', bearerToken: 'a'.repeat(43), tools: ['post_blocks'] }
  const bins = { claudeShim: { command: 'node', args: ['shim'] }, codexAdapter: { command: 'node', args: ['adapter'] } }

  it('hands Claude Code a strict --mcp-config and Codex a pre-approved mcp_servers entry', () => {
    const claude = resolveFamilyLaunch('claude-code', { configHome: '/cfg', flags: ['--permission-mode', 'default'], mcpServers: [server] }, bins)
    expect(claude.args.slice(-3)).toEqual(['--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: { candy_mountain_slack: { type: 'http', url: server.url, headers: { Authorization: `Bearer ${server.bearerToken}` } } } })])
    expect(resolveFamilyLaunch('claude-code', { configHome: '/cfg', flags: [] }, bins).args).not.toContain('--mcp-config')

    const codex = resolveFamilyLaunch('codex', { configHome: '/cfg', codex: { mode: 'workspace-write' }, mcpServers: [server] }, bins)
    expect(JSON.parse(codex.env.CODEX_CONFIG!).mcp_servers).toEqual({
      candy_mountain_slack: { url: server.url, http_headers: { Authorization: `Bearer ${server.bearerToken}` }, enabled_tools: ['post_blocks'], default_tools_approval_mode: 'approve' },
    })
  })

  it('refuses anything but a named loopback endpoint', () => {
    for (const bad of [{ url: 'http://example.com:80/mcp' }, { url: 'https://127.0.0.1:4555/mcp' }, { url: 'http://localhost:4555/mcp' }, { bearerToken: 'short' }, { tools: [] }, { name: 'Bad Name' }]) {
      expect(() => resolveFamilyLaunch('codex', { configHome: '/cfg', mcpServers: [{ ...server, ...bad }] }, bins), JSON.stringify(bad)).toThrow()
    }
  })
})

describe('MCP host', () => {
  let host: AgentMcpHost | undefined
  let temp: TempDataDir | undefined
  let platform: Platform | undefined
  afterEach(async () => {
    await host?.close()
    host = undefined
    platform?.close()
    platform = undefined
    temp?.cleanup()
    temp = undefined
  })

  it('serves only the session it issued the token to, over loopback POST', async () => {
    temp = createTempDataDir()
    platform = startPlatform(temp.root, { secretsKey: MasterKey.generate() })
    const project = await createProject(platform.db, { name: 'beta', slug: 'beta', source: { kind: 'local-path', path: temp.root } })
    const plain = platform.sessions.create({ projectId: project.id, family: 'claude-code', actorId: 'u', cwd: temp.root })
    const bot = platform.sessions.create({ projectId: project.id, family: 'claude-code', actorId: 'u', cwd: temp.root, posture: { bot: { id: 'b', name: 'B', holder: { kind: 'slack', id: 'b:C1:1.1' } } } })
    host = startAgentMcpHost({ db: platform.db, servers: [slackMcpServer({ db: platform.db, slack: { web: () => null } })] })
    expect(await host.serversFor(plain)).toEqual([])
    const [registration] = await host.serversFor(bot)
    expect(registration).toMatchObject({ name: 'candy_mountain_slack', tools: ['post_blocks'] })
    const post = (body: unknown, headers: Record<string, string> = {}, url = registration!.url) =>
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${registration!.bearerToken}`, ...headers }, body: JSON.stringify(body) })

    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
    expect(await init.json()).toMatchObject({ result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'candy_mountain_slack' } } })
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    expect(await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).toMatchObject({ result: { tools: [{ name: 'post_blocks', inputSchema: { required: ['text', 'blocks'] } }] } })
    // No slack_threads row maps this session, so the call is refused before Slack is touched.
    expect(await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'post_blocks', arguments: { text: 'x', blocks: [SECTION] } } })).json()).toMatchObject({ result: { isError: true, content: [{ text: expect.stringContaining('not answering an open Slack thread') }] } })

    expect((await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await post({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, {}, registration!.url.replace(bot.id, plain.id))).status).toBe(401)
    expect((await post({ jsonrpc: '2.0', id: 6, method: 'tools/list' }, { origin: 'http://evil.test' })).status).toBe(403)
    expect((await fetch(registration!.url, { headers: { authorization: `Bearer ${registration!.bearerToken}` } })).status).toBe(405)
  })
})

const CLAUDE_PERSONA = '---\nname: ana\ndescription: Ana fixes small issues.\n---\nYou are Ana. Keep changes small.\n'
const JACK = 'U0JACK'
const BOT_USER = 'U0BOT'

/** A claude CLI stand-in that, asked to, drives the MCP server it was launched with the way the real client does. */
const MCP_CLAUDE = `import readline from 'node:readline'
const emit = x => process.stdout.write(JSON.stringify(x) + '\\n')
const args = process.argv.slice(2)
const id = args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1]
const at = args.indexOf('--mcp-config')
const config = at === -1 ? null : JSON.parse(args[at + 1])
const rpc = async (server, body) => {
  const response = await fetch(server.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...server.headers }, body: JSON.stringify(body) })
  return response.status === 202 ? null : response.json()
}
for await (const line of readline.createInterface({ input: process.stdin })) {
  const value = JSON.parse(line)
  if (value.type === 'control_request') {
    emit({ type: 'control_response', response: { subtype: 'success', request_id: value.request_id, response: value.request.subtype === 'initialize' ? { commands: [], account: { email: 'a@example.com', apiProvider: 'firstParty' } } : {} } })
    continue
  }
  if (value.type !== 'user') continue
  const text = value.message.content[0]?.text ?? ''
  const request = /POST-BLOCKS (\\{.*\\})/s.exec(text)
  let reply = 'mcp: ' + (config ? Object.keys(config.mcpServers).join(',') : 'none') + ' strict: ' + args.includes('--strict-mcp-config')
  if (config && request) {
    const server = config.mcpServers.candy_mountain_slack
    await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '0' } } })
    await rpc(server, { jsonrpc: '2.0', method: 'notifications/initialized' })
    const called = await rpc(server, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'post_blocks', arguments: JSON.parse(request[1]) } })
    reply = 'tool: ' + JSON.stringify(called.result)
  }
  emit({ type: 'assistant', session_id: id, message: { content: [{ type: 'text', text: reply }] } })
  emit({ type: 'result', subtype: 'success', session_id: id, result: reply })
}
`

describe('Block Kit tool end to end', () => {
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
  })

  function fakeTransport() {
    const bus: SlackEventBus = createSlackEventBus({ error: () => {} })
    const calls: Array<{ method: string, body: Record<string, unknown> }> = []
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
    return { bus, slack, calls }
  }

  let eventCounter = 0
  function mention(botId: string, projectId: string, text: string, ts: string, threadTs: string | null = null): SlackMessageBotEvent {
    const event = { channel: 'C01LISTED', channelType: 'channel', user: JACK, senderBotId: null, subtype: null, text, ts, threadTs, raw: {} }
    return { kind: threadTs ? 'message' : 'app_mention', botId, projectId, envelopeId: `env-${++eventCounter}`, retryAttempt: 0, retryReason: null, receivedAt: new Date().toISOString(), botUserId: BOT_USER, eventId: `EvMcp${eventCounter}`, teamId: 'T0CANDY', fromSelf: false, event }
  }

  async function setup() {
    repo = createTempGitRepo()
    const file = join(repo.clone, '.claude/agents/ana.md')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, CLAUDE_PERSONA)
    repo.git(repo.clone, 'add', '.claude/agents/ana.md')
    repo.git(repo.clone, 'commit', '--quiet', '-m', 'persona')
    repo.git(repo.clone, 'push', '--quiet', 'origin', 'main')
    stubHosts()
    temp = createTempDataDir()
    const transport = fakeTransport()
    const p = startPlatform(temp.root, { secretsKey: MasterKey.generate(), acp: { bins: fakeBins, killTimeoutMs: 1000 }, agentMcp: { slack: transport.slack } })
    platform = p
    const script = join(temp.root, 'mcp-claude.mjs')
    writeFileSync(script, MCP_CLAUDE)
    const claudePath = join(temp.root, 'claude')
    writeFileSync(claudePath, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`)
    chmodSync(claudePath, 0o755)
    const project = await createProject(p.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: repo.clone } })
    const health = (type: 'repository' | 'claude-code', config: Record<string, unknown>, secrets: Record<string, string> = {}) => {
      const id = createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type, scope: 'project', projectId: project.id, config, secrets }).id
      p.db.update(pluginInstances).set({ health: { healthy: true }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, id)).run()
    }
    health('repository', { host: 'github', owner: 'jack', repo: 'candy' }, { token: GOOD_TOKEN })
    health('claude-code', { claudePath })
    const readDeps: BotReadDeps = { db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets }
    const bot = await createBot(readDeps, project.id, parseCreateBot({ name: 'Ana Bot', family: 'claude-code', writeScope: 'write-confirm', personaName: 'ana', answersIn: { channels: ['C01LISTED'] } }))
    expect(recordBotPersonaCheck(p.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(true)
    addTeamMember(p.db, project.id, { displayName: 'Jack', email: null, slackMemberId: JACK, botScope: { all: true } })
    router = startSlackRouter({ db: p.db, slack: transport.slack, botSessions: p.botSessions, sessions: p.sessions }, { log: { error: () => {} } })
    return { p, project, bot, transport, router }
  }

  it('posts the bot\'s Block Kit into its own thread, refuses another channel, and gives plain sessions no MCP server', async () => {
    const { p, project, bot, transport, router: r } = await setup()
    const send = async (event: SlackMessageBotEvent) => {
      transport.bus.emit(event)
      await r.idle()
    }
    const blockPosts = () => transport.calls.filter(call => call.method === 'chat.postMessage' && call.body.blocks !== undefined).map(call => call.body)
    const payload = { text: 'Build passed', blocks: [SECTION, { type: 'divider' }] }

    await send(mention(bot.id, project.id, `<@${BOT_USER}> POST-BLOCKS ${JSON.stringify(payload)}`, '1.1'))
    const thread = findSlackThread(p.db, { botId: bot.id, channelId: 'C01LISTED', threadTs: '1.1' })!
    const session = p.sessions.get(thread.sessionId)!
    expect(session.posture?.flags?.[session.posture.flags.indexOf('--allowedTools') + 1]).toBe(`Bash(bd *),${RULE}`)
    expect(blockPosts()).toEqual([{ channel: 'C01LISTED', thread_ts: '1.1', ...payload }])
    const agentText = () => p.sessions.events(session.id).filter(e => e.kind === 'text' && e.role === 'agent').map(e => (e as { text: string }).text)
    expect(agentText().at(-1)).toContain('Posted to the Slack thread (message ts 9.')

    await send(mention(bot.id, project.id, `POST-BLOCKS ${JSON.stringify({ ...payload, channel: 'C02OTHER' })}`, '1.2', '1.1'))
    expect(blockPosts()).toHaveLength(1)
    expect(agentText().at(-1)).toContain('"isError":true')
    expect(agentText().at(-1)).toContain('channel \\"C02OTHER\\"')

    const plain = p.sessions.create({ projectId: project.id, family: 'claude-code', actorId: 'u', cwd: repo!.clone })
    await p.sessions.prompt(plain.id, 'which mcp')
    await expect.poll(() => p.sessions.events(plain.id).find(e => e.kind === 'text' && e.role === 'agent'), { timeout: 20_000 }).toMatchObject({ text: 'mcp: none strict: false' })
    expect(transport.calls.filter(call => call.body.blocks !== undefined)).toHaveLength(1)
  }, 120_000)
})
