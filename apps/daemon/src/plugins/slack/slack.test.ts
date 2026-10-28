import { pluginTypeInfo, PLUGIN_SCOPES } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startPlatform } from '../../platform'
import { createTempDataDir } from '../../testing'
import { checkPluginHealth } from '../health'
import { createPluginTypeRegistry } from '../registry'
import { PLUGIN_TYPES } from '../types'
import { createSlackOperations, slackConfig, slackPluginType, SlackApiError, type SlackConfig } from '.'

const GOOD_TOKEN = 'xoxb-good-token-123'

interface Recorded { method: string, url: string, headers: Headers, body: Record<string, unknown>, signal: AbortSignal | null | undefined }

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** An in-memory Slack workspace; `override` answers first. */
function stubSlack(override?: (request: Recorded) => Response | undefined) {
  const requests: Recorded[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: Recorded = {
      method: init.method ?? 'GET',
      url: String(input),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {},
      signal: init.signal,
    }
    requests.push(request)
    return override?.(request) ?? slack(request)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

function slack({ url, headers, body }: Recorded): Response {
  if (headers.get('authorization') !== `Bearer ${GOOD_TOKEN}`) return json(200, { ok: false, error: 'invalid_auth' })
  switch (url) {
    case 'https://slack.com/api/auth.test':
      return json(200, { ok: true, url: 'https://candy.slack.com/', team: 'Candy', user: 'candybot', team_id: 'T0001', user_id: 'U0BOT', bot_id: 'B0001' })
    case 'https://slack.com/api/conversations.open':
      return body.users === 'U0JACK' ? json(200, { ok: true, channel: { id: 'D0JACK' } }) : json(200, { ok: false, error: 'user_not_found' })
    case 'https://slack.com/api/chat.postMessage':
      if (body.channel === 'C0PRIVATE') return json(200, { ok: false, error: 'not_in_channel' })
      return json(200, { ok: true, channel: body.channel, ts: '1730000000.000100', message: { text: body.text } })
    default:
      return json(200, { ok: false, error: 'unknown_method' })
  }
}

const secretsWith = (token?: string) => ({ get: () => token })
const ops = (config: SlackConfig = { defaultChannelId: 'C0ALERTS' }, token: string | undefined = GOOD_TOKEN) => createSlackOperations(config, secretsWith(token))
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e)
  expect(error).toBeInstanceOf(SlackApiError)
  return error as SlackApiError
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('slack plugin type', () => {
  it('is registered as a single-instance, global-only type', () => {
    expect(PLUGIN_TYPES).toContain(slackPluginType)
    expect(createPluginTypeRegistry(PLUGIN_TYPES).get('slack')).toBe(slackPluginType)
    const info = pluginTypeInfo(slackPluginType)
    expect(info.singleInstance).toBe(true)
    expect(info.configFields.map(f => f.name)).toEqual(['defaultChannelId'])
    expect(info.secretFields).toEqual([expect.objectContaining({ name: 'botToken', required: true })])
  })

  // Instances reject a scope their type does not list, so this list is what refuses a project-scoped Slack instance.
  it('rejects the project scope', () => {
    expect(PLUGIN_SCOPES).toContain('project')
    expect(slackPluginType.scopes).toEqual(['global'])
    expect(slackPluginType.scopes.includes('project')).toBe(false)
  })

  it('validates stored config', () => {
    expect(slackConfig({ defaultChannelId: ' C0ALERTS ' })).toEqual({ defaultChannelId: 'C0ALERTS' })
    expect(slackConfig({})).toEqual({})
    expect(() => slackConfig({ defaultChannelId: '#alerts' })).toThrow(/^Invalid Slack config: defaultChannelId: /)
  })

  it('boots the daemon with it registered', () => {
    const temp = createTempDataDir()
    try {
      const platform = startPlatform(temp.root)
      expect(platform.pluginTypes.ids()).toContain('slack')
      platform.close()
    }
    finally {
      temp.cleanup()
    }
  })
})

describe('slack health', () => {
  const health = (token?: string) => checkPluginHealth(slackPluginType, { config: { defaultChannelId: 'C0ALERTS' }, secrets: secretsWith(token) })

  it('is healthy when auth.test succeeds', async () => {
    const { requests } = stubSlack()
    expect(await health(GOOD_TOKEN)).toEqual({ healthy: true, detail: 'Connected to Candy as @candybot.' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', url: 'https://slack.com/api/auth.test' })
    expect(requests[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('is unhealthy with Slack\'s reason for a wrong token', async () => {
    stubSlack()
    expect(await health('xoxb-wrong')).toEqual({ healthy: false, reason: 'Slack auth.test failed: invalid_auth (the bot token is invalid or has been revoked).' })
  })

  it('is unhealthy without calling Slack when no token is set', async () => {
    const { fetchMock } = stubSlack()
    expect(await health()).toEqual({ healthy: false, reason: 'No Slack bot token is set.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('redacts the token when Slack cannot be reached', async () => {
    stubSlack(() => {
      throw new TypeError(`fetch failed: Authorization: Bearer ${GOOD_TOKEN}`)
    })
    const result = await health(GOOD_TOKEN)
    expect(result).toEqual({ healthy: false, reason: 'Could not reach Slack: fetch failed: Authorization: Bearer [redacted]' })
  })
})

describe('slack postMessage', () => {
  it('posts text to a channel with the bot token', async () => {
    const { requests } = stubSlack()
    expect(await ops().postMessage({ channel: 'C0DEPLOYS', text: 'Deploy succeeded' })).toEqual({ channel: 'C0DEPLOYS', ts: '1730000000.000100' })
    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request!.url).toBe('https://slack.com/api/chat.postMessage')
    expect(request!.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(request!.body).toEqual({ channel: 'C0DEPLOYS', text: 'Deploy succeeded' })
  })

  it('posts Block Kit blocks with fallback text', async () => {
    const { requests } = stubSlack()
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*Bot finished*' } }]
    await ops().postMessage({ channel: 'C0DEPLOYS', text: 'Bot finished', blocks })
    expect(requests[0]!.body).toEqual({ channel: 'C0DEPLOYS', text: 'Bot finished', blocks })
    await ops().postMessage({ channel: 'C0DEPLOYS', blocks })
    expect(requests[1]!.body).toEqual({ channel: 'C0DEPLOYS', blocks })
  })

  it('falls back to the default channel', async () => {
    const { requests } = stubSlack()
    expect(await ops().postMessage({ text: 'hi' })).toEqual({ channel: 'C0ALERTS', ts: '1730000000.000100' })
    expect(requests[0]!.body.channel).toBe('C0ALERTS')
  })

  it('opens a direct message before posting to a member', async () => {
    const { requests } = stubSlack()
    expect(await ops().postMessage({ memberId: 'U0JACK', text: 'Your bot finished' })).toEqual({ channel: 'D0JACK', ts: '1730000000.000100' })
    expect(requests.map(r => r.url)).toEqual(['https://slack.com/api/conversations.open', 'https://slack.com/api/chat.postMessage'])
    expect(requests[0]!.body).toEqual({ users: 'U0JACK' })
    expect(requests[1]!.body).toEqual({ channel: 'D0JACK', text: 'Your bot finished' })
  })

  it('reports Slack errors with a hint', async () => {
    stubSlack()
    const notInChannel = await failure(ops().postMessage({ channel: 'C0PRIVATE', text: 'hi' }))
    expect(notInChannel).toMatchObject({ code: 'slack_error', slackError: 'not_in_channel', method: 'chat.postMessage', message: 'Slack chat.postMessage failed: not_in_channel (invite the bot to the channel first).' })
    const unknownMember = await failure(ops().postMessage({ memberId: 'U0NOBODY', text: 'hi' }))
    expect(unknownMember).toMatchObject({ slackError: 'user_not_found', method: 'conversations.open' })
  })

  it('names the missing scope', async () => {
    stubSlack(() => json(200, { ok: false, error: 'missing_scope', needed: 'im:write', provided: 'chat:write' }))
    expect((await failure(ops().postMessage({ memberId: 'U0JACK', text: 'hi' }))).message).toBe('Slack conversations.open failed: missing_scope (the bot token needs the im:write scope).')
  })

  it('reports rate limits with the retry delay', async () => {
    stubSlack(() => json(429, { ok: false, error: 'ratelimited' }, { 'retry-after': '30' }))
    expect(await failure(ops().postMessage({ text: 'hi' }))).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 30, message: 'Slack rate-limited chat.postMessage; retry in 30 s.' })
  })

  it('reports non-JSON and server failures', async () => {
    stubSlack(() => new Response('<html>oops</html>', { status: 200 }))
    expect(await failure(ops().postMessage({ text: 'hi' }))).toMatchObject({ code: 'invalid_response' })
    stubSlack(() => new Response('bad gateway', { status: 502 }))
    expect(await failure(ops().postMessage({ text: 'hi' }))).toMatchObject({ code: 'unavailable', status: 502, message: 'Slack returned 502 for chat.postMessage.' })
  })

  it('rejects bad messages without calling Slack', async () => {
    const { fetchMock } = stubSlack()
    const cases: [Parameters<ReturnType<typeof ops>['postMessage']>[0], string][] = [
      [{ channel: 'C0DEPLOYS' }, 'A message needs text or blocks.'],
      [{ channel: 'C0DEPLOYS', text: '  ', blocks: [] }, 'A message needs text or blocks.'],
      [{ channel: 'C0DEPLOYS', blocks: [{ text: 'no type' }] }, 'Every block needs a type.'],
      [{ channel: 'C0DEPLOYS', blocks: Array.from({ length: 51 }, () => ({ type: 'divider' })) }, 'A message can have at most 50 blocks.'],
      [{ memberId: 'jack', text: 'hi' }, '\'jack\' is not a Slack member id.'],
      // @ts-expect-error a channel and a member together is a compile error too
      [{ channel: 'C0DEPLOYS', memberId: 'U0JACK', text: 'hi' }, 'Give a channel or a member, not both.'],
    ]
    for (const [message, reason] of cases) {
      expect(await failure(ops().postMessage(message))).toMatchObject({ code: 'invalid_request', message: reason })
    }
    expect(await failure(ops({}).postMessage({ text: 'hi' }))).toMatchObject({ message: 'No channel or member was given and no default channel is configured.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts in-flight requests with the given signal', async () => {
    stubSlack(({ signal }) => {
      expect(signal?.aborted).toBe(true)
      throw new DOMException('aborted', 'AbortError')
    })
    const controller = new AbortController()
    controller.abort()
    const operations = createSlackOperations({}, secretsWith(GOOD_TOKEN), { signal: controller.signal })
    await expect(operations.postMessage({ channel: 'C0DEPLOYS', text: 'hi' })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
