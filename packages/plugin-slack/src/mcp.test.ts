import type { AgentSession } from '@candy-mountain/platform-sdk'
import { describe, expect, it } from 'vitest'
import { createSlackClient } from './client'
import type { SlackBotSource, SlackSessionThread } from './manager'
import { SLACK_POST_BLOCKS_TOOL, slackMcpServer } from './mcp'
import { createSlackOperations } from './operations'

const SECTION = { type: 'section', text: { type: 'mrkdwn', text: '*Build* passed' } }
const THREAD: SlackSessionThread = { botId: 'b1', channelId: 'C1', threadTs: '1.1', open: true, holderId: 'b1:C1:1.1' }

const session = (botId = 'b1', holderId = 'b1:C1:1.1', kind = 'slack') =>
  ({ id: 's1', posture: { bot: { id: botId, name: 'Ana', holder: { kind, id: holderId } } } }) as unknown as AgentSession

function server(thread: SlackSessionThread | null, token: string | null = 'xoxb-ana') {
  const posts: Array<Record<string, unknown>> = []
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return Response.json({ ok: true, ts: '9.1' })
  }
  const source: SlackBotSource = { connectionTargets: () => [], botToken: () => token ?? undefined, notificationSenders: () => [], threadForSession: id => (id === 's1' ? thread : null) }
  const definition = slackMcpServer({
    slack: {
      source: () => source,
      web: (_botId, options) => (token ? { client: createSlackClient(token, options), operations: createSlackOperations({}, { get: () => token }, options) } : null),
    },
  }, { fetch })
  const call = (args: Record<string, unknown>, as = session()) => definition.tools[0]!.call(args, { session: as, signal: new AbortController().signal })
  return { definition, posts, call }
}

describe('the Slack MCP server', () => {
  it('applies to Slack-held bot sessions only', () => {
    const { definition } = server(THREAD)
    expect(definition.name).toBe(SLACK_POST_BLOCKS_TOOL.server)
    expect(definition.tools.map(t => t.name)).toEqual([SLACK_POST_BLOCKS_TOOL.tool])
    expect(definition.appliesTo(session())).toBe(true)
    expect(definition.appliesTo(session('b1', 'x', 'console'))).toBe(false)
    expect(definition.appliesTo({ id: 's2' } as AgentSession)).toBe(false)
  })

  it('posts into the session\'s own thread and nowhere else', async () => {
    const { posts, call } = server(THREAD)
    expect(await call({ text: 'Build', blocks: [SECTION] })).toEqual({ text: 'Posted to the Slack thread (message ts 9.1).' })
    expect(posts).toEqual([{ channel: 'C1', thread_ts: '1.1', text: 'Build', blocks: [SECTION] }])
    expect(await call({ text: 'Build', blocks: [SECTION], channel: 'C2' })).toMatchObject({ isError: true, text: expect.stringContaining('channel "C2"') })
    expect(posts).toHaveLength(1)
  })

  it('refuses a session the source maps to no open thread of its bot, and a bot without a token', async () => {
    const refused = { isError: true, text: 'This session is not answering an open Slack thread, so nothing was posted.' }
    expect(await server(null).call({ text: 'x', blocks: [SECTION] })).toEqual(refused)
    expect(await server({ ...THREAD, open: false }).call({ text: 'x', blocks: [SECTION] })).toEqual(refused)
    expect(await server(THREAD).call({ text: 'x', blocks: [SECTION] }, session('b2'))).toEqual(refused)
    expect(await server(THREAD).call({ text: 'x', blocks: [SECTION] }, session('b1', 'b1:C1:2.2'))).toEqual(refused)
    expect(await server(THREAD, null).call({ text: 'x', blocks: [SECTION] })).toEqual({ isError: true, text: 'The bot has no Slack bot token, so nothing was posted.' })
  })
})
