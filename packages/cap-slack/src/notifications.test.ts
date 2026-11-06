import type { ScopeLabel, Workspace } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { createPluginInstance, type InstanceHarness, instanceHarness, type NotificationDelivery } from '@candy-mountain/platform-daemon'
import { createSlackClient, type SlackClientOptions } from './client'
import type { SlackBotSource, SlackNotificationSender } from './manager'
import { slackNotificationChannel } from './notifications'
import { createSlackOperations } from './operations'
import { slackPluginType } from './plugin-type'

const PROJECT: ScopeLabel = { singular: 'project', plural: 'projects', singularTitle: 'Project', pluralTitle: 'Projects' }

interface Call { method: string, token: string, body: Record<string, unknown> }

let h: InstanceHarness
const calls: Call[] = []

afterEach(() => {
  h?.close()
  calls.length = 0
})

const fakeFetch: typeof fetch = async (input, init) => {
  const method = String(input).split('/').at(-1)!
  const token = String(new Headers(init?.headers).get('authorization')).replace('Bearer ', '')
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  calls.push({ method, token, body })
  if (method === 'conversations.open') return Response.json({ ok: true, channel: { id: `D-${body.users}` } })
  if (method === 'chat.postMessage') return Response.json({ ok: true, channel: body.channel, ts: '1.2' })
  return Response.json({ ok: false, error: 'unknown_method' })
}

/** The bots capability's part: which bots may send, and their tokens. */
function channel(senders: SlackNotificationSender[] | null, tokens: Record<string, string> = {}) {
  const source: SlackBotSource | null = senders && {
    connectionTargets: () => [],
    botToken: botId => tokens[botId],
    notificationSenders: () => senders,
    threadForSession: () => null,
  }
  const slack = {
    source: () => source,
    web(botId: string, options?: SlackClientOptions) {
      const token = tokens[botId]
      return token ? { client: createSlackClient(token, options), operations: createSlackOperations({}, { get: () => token }, options) } : null
    },
  }
  return slackNotificationChannel({ ...h.deps, slack, scopeUrlPrefix: 'p', scopeLabel: PROJECT }, { fetch: fakeFetch })
}

async function setup(): Promise<Workspace> {
  h = instanceHarness([slackPluginType])
  return h.createWorkspace('alpha')
}

const addPlugin = () => createPluginInstance(h.deps, { type: 'slack', scope: 'global', workspaceId: null, config: {}, secrets: { botToken: 'xoxb-plugin' } })

const delivery = (workspace: Workspace, destination: NotificationDelivery['destination']): NotificationDelivery =>
  ({ workspaceId: workspace.id, kind: 'incident.opened', destination, title: 'API <down>', url: 'http://web.test/p/alpha' }) as NotificationDelivery

describe('the Slack notification channel', () => {
  it('describes no sender, then the platform plugin, then the first bot the source names', async () => {
    const workspace = await setup()
    expect(channel(null).describe(workspace)).toEqual({
      label: 'Slack',
      sender: null,
      setupHelp: 'Add a Slack bot token to one of this project\'s bots, or configure the Slack plugin.',
      setup: { label: 'Set up Slack', link: '/p/alpha/setup/plugins' },
      destinations: expect.objectContaining({ channel: expect.any(Object), member: expect.any(Object) }),
    })
    addPlugin()
    expect(channel(null).describe(workspace).sender).toBe('Platform Slack plugin')
    expect(channel([]).describe(workspace).sender).toBe('Platform Slack plugin')
    expect(channel([{ id: 'b1', name: 'Ana' }, { id: 'b2', name: 'Bob' }], { b1: 'xoxb-ana' }).describe(workspace).sender).toBe('Project bot Ana')
  })

  it('declines without a sender, posts through the plugin without bots, and prefers the first bot with a token', async () => {
    const workspace = await setup()
    const signal = new AbortController().signal
    expect(await channel(null).deliver(delivery(workspace, { channelId: 'C1' }), signal)).toBe(false)
    expect(calls).toEqual([])

    addPlugin()
    expect(await channel(null).deliver(delivery(workspace, { channelId: 'C1' }), signal)).toBe(true)
    expect(calls).toEqual([{ method: 'chat.postMessage', token: 'xoxb-plugin', body: { channel: 'C1', text: 'API &lt;down&gt;\n<http://web.test/p/alpha|Open in Candy Mountain>' } }])

    calls.length = 0
    expect(await channel([{ id: 'b0', name: 'Keyless' }, { id: 'b1', name: 'Ana' }], { b1: 'xoxb-ana' }).deliver(delivery(workspace, { memberId: 'U1' }), signal)).toBe(true)
    expect(calls.map(c => [c.method, c.token])).toEqual([['conversations.open', 'xoxb-ana'], ['chat.postMessage', 'xoxb-ana']])
    expect(calls[1]!.body).toMatchObject({ channel: 'D-U1' })
  })
})
