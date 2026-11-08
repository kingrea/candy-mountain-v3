import type { SlackBotEvent } from './events'
import { nextEnvelopeId, startFakeSocketMode, type FakeSocketMode } from './fake-socket-mode'
import { startSlackConnections, type SlackBotSource, type SlackConnections, type SlackConnectionsOptions, type SlackConnectionTarget } from './manager'
import { afterEach, describe, expect, it } from 'vitest'

const APP_TOKEN = 'xapp-1-valid'
const BOT_TOKEN = 'xoxb-valid'

let fake: FakeSocketMode
let manager: SlackConnections | undefined
let bots: ReturnType<typeof fakeSource>
const errors: unknown[][] = []

afterEach(async () => {
  await manager?.close()
  manager = undefined
  await fake?.close()
  errors.length = 0
})

async function until(check: () => boolean, what: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Stands in for the bots capability: targets and tokens are whatever the test sets. */
function fakeSource() {
  const targets = new Map<string, SlackConnectionTarget>()
  const source: SlackBotSource & { targets: typeof targets } = {
    targets,
    connectionTargets: () => [...targets.values()],
    botToken: botId => targets.get(botId)?.eligible === true ? (targets.get(botId) as { botToken: string }).botToken : undefined,
    notificationSenders: () => [],
    threadForSession: () => null,
  }
  return source
}

const eligible = (botId: string, { app = APP_TOKEN, bot = BOT_TOKEN } = {}): SlackConnectionTarget => ({ botId, projectId: 'p1', eligible: true, appToken: app, botToken: bot })

async function setup() {
  fake = await startFakeSocketMode()
  fake.validAppTokens.add(APP_TOKEN)
  fake.validBotTokens.add(BOT_TOKEN)
  bots = fakeSource()
}

function start(options: SlackConnectionsOptions = {}, attach = true) {
  manager = startSlackConnections({
    reconcileMs: 60_000,
    log: { error: (...args: unknown[]) => void errors.push(args) },
    socket: { fetch: fake.fetch, initialBackoffMs: 20, maxBackoffMs: 100, invalidTokenRetryMs: 100, pingIntervalMs: 50, pongTimeoutMs: 200 },
    ...options,
  })
  if (attach) manager.attach(bots)
  return manager
}

let botCount = 0

/** A null bot token stands for a bot the source reports as missing its keys. */
function addBot({ app = APP_TOKEN, bot = BOT_TOKEN as string | null } = {}) {
  const id = `b${++botCount}`
  bots.targets.set(id, bot === null ? { botId: id, projectId: 'p1', eligible: false, code: 'missing_keys', reason: 'Slack bot token is not set.' } : eligible(id, { app, bot }))
  return id
}

describe('Slack Socket Mode connections', () => {
  it('connects nothing until a source is attached, then follows its targets', async () => {
    await setup()
    const slack = start({ reconcileMs: 20 }, false)
    expect(slack.source()).toBeNull()
    expect(slack.status('b1')).toMatchObject({ state: 'disconnected', reasonCode: 'inactive', reason: 'No such bot.' })

    const source = fakeSource()
    source.targets.set('b1', { botId: 'b1', projectId: 'p1', eligible: false, code: 'inactive', reason: 'The bot is not active: persona.' })
    slack.attach(source)
    expect(slack.source()).toBe(source)
    expect(slack.status('b1')).toMatchObject({ state: 'disconnected', reasonCode: 'inactive', reason: 'The bot is not active: persona.' })
    expect(fake.links).toHaveLength(0)

    source.targets.set('b1', eligible('b1'))
    await until(() => slack.status('b1').state === 'connected', 'connected')
    expect(slack.status('b1')).toMatchObject({ reason: null, reasonCode: null, identity: { teamId: 'T0CANDY', team: 'Candy', userId: 'U0BOT', user: 'ana' } })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(fake.links).toHaveLength(1)

    source.targets.set('b1', { botId: 'b1', projectId: 'p1', eligible: false, code: 'missing_keys', reason: 'Slack app-level token is not set.' })
    await until(() => fake.open().length === 0, 'the link to close')
    expect(slack.status('b1')).toMatchObject({ state: 'disconnected', reasonCode: 'missing_keys', reason: 'Slack app-level token is not set.' })

    source.targets.set('b1', eligible('b1'))
    await until(() => slack.status('b1').state === 'connected', 'reconnected')
    source.targets.delete('b1')
    await until(() => fake.open().length === 0, 'the removed bot to close')
    expect(fake.links).toHaveLength(2)
  })

  it('acknowledges every envelope and emits typed events keyed by bot', async () => {
    await setup()
    const id = addBot()
    const slack = start()
    const events: SlackBotEvent[] = []
    const elsewhere: SlackBotEvent[] = []
    slack.subscribe(event => void events.push(event))
    slack.subscribe(event => void elsewhere.push(event), { botId: 'other' })
    slack.subscribe(() => {
      throw new Error('listener bug')
    }, { kinds: ['slash'] })
    await until(() => slack.status(id).state === 'connected', 'connected')
    const [link] = fake.open()

    const envelopes = [
      { type: 'events_api', envelope_id: nextEnvelopeId(), retry_attempt: 1, retry_reason: 'timeout', payload: { event_id: 'Ev1', team_id: 'T0CANDY', event: { type: 'app_mention', channel: 'C1', user: 'U0JACK', text: '<@U0BOT> fix it', ts: '1.1' } } },
      { type: 'events_api', envelope_id: nextEnvelopeId(), payload: { event_id: 'Ev2', event: { type: 'message', channel: 'C1', user: 'U0BOT', bot_id: 'B0BOT', text: 'on it', ts: '1.2', thread_ts: '1.1' } } },
      { type: 'events_api', envelope_id: nextEnvelopeId(), payload: { event_id: 'Ev3', event: { type: 'reaction_added', user: 'U0JACK' } } },
      { type: 'interactive', envelope_id: nextEnvelopeId(), payload: { type: 'block_actions', user: { id: 'U0JACK' }, channel: { id: 'C1' }, message: { ts: '1.3', thread_ts: '1.1' }, actions: [{ action_id: 'allow', block_id: 'b1', type: 'button', value: 'd1' }], response_url: 'https://hooks.slack.test/r' } },
      { type: 'slash_commands', envelope_id: nextEnvelopeId(), payload: { command: '/candy', text: 'status', user_id: 'U0JACK', channel_id: 'C1' } },
    ]
    for (const envelope of envelopes) fake.send(link!, envelope)
    await until(() => link!.acks.length === envelopes.length && events.length === 4, 'acks and events')

    expect(link!.acks).toEqual(envelopes.map(e => e.envelope_id))
    expect(elsewhere).toEqual([])
    expect(errors).toEqual([['Slack event listener failed:', new Error('listener bug')]])
    expect(events[0]).toMatchObject({
      kind: 'app_mention', botId: id, projectId: 'p1', envelopeId: envelopes[0]!.envelope_id, retryAttempt: 1, retryReason: 'timeout', botUserId: 'U0BOT',
      eventId: 'Ev1', teamId: 'T0CANDY', fromSelf: false,
      event: { channel: 'C1', user: 'U0JACK', senderBotId: null, text: '<@U0BOT> fix it', ts: '1.1', threadTs: null },
    })
    expect(events[1]).toMatchObject({ kind: 'message', eventId: 'Ev2', fromSelf: true, retryAttempt: 0, event: { threadTs: '1.1', senderBotId: 'B0BOT' } })
    expect(events[2]).toMatchObject({
      kind: 'interactive',
      interaction: { type: 'block_actions', userId: 'U0JACK', channelId: 'C1', messageTs: '1.3', threadTs: '1.1', actions: [{ actionId: 'allow', blockId: 'b1', type: 'button', value: 'd1' }], responseUrl: 'https://hooks.slack.test/r' },
    })
    expect(events[3]).toMatchObject({ kind: 'slash', command: { command: '/candy', text: 'status', userId: 'U0JACK', channelId: 'C1' } })
  })

  it('reconnects when Slack asks for a refresh, when the network drops and when pings go unanswered', async () => {
    await setup()
    const id = addBot()
    const slack = start()
    await until(() => slack.status(id).state === 'connected', 'connected')

    fake.send(fake.open()[0]!, { type: 'disconnect', reason: 'refresh_requested' })
    await until(() => fake.links.length === 2 && fake.open().length === 1 && slack.status(id).state === 'connected', 'the refreshed link')

    fake.dropAll()
    await until(() => fake.links.length === 3 && fake.open().length === 1 && slack.status(id).state === 'connected', 'the link after a drop')

    fake.open()[0]!.silent = true
    await until(() => fake.links.length === 4 && fake.open().length === 1 && slack.status(id).state === 'connected', 'the link after pings went unanswered')

    fake.reachable = false
    fake.dropAll()
    await until(() => slack.status(id).reasonCode === 'error', 'an unreachable Slack')
    expect(slack.status(id)).toMatchObject({ state: 'disconnected', reason: expect.stringMatching(/^Slack apps\.connections\.open|Could not reach Slack/), retryAt: expect.any(String) })
    fake.reachable = true
    await until(() => slack.status(id).state === 'connected', 'connected after the outage')
    expect(fake.open()).toHaveLength(1)
  })

  it('reports a rejected token and connects as soon as the token is replaced', async () => {
    await setup()
    const badApp = addBot({ app: 'xapp-1-revoked' })
    const badBot = addBot({ bot: 'xoxb-revoked' })
    const slack = start()
    await until(() => slack.status(badApp).reasonCode === 'invalid_token' && slack.status(badBot).reasonCode === 'invalid_token', 'rejections')
    expect(slack.status(badApp)).toMatchObject({ state: 'disconnected', reason: 'Slack rejected the app-level token: invalid_auth (it is invalid or has been revoked).', retryAt: expect.any(String) })
    expect(slack.status(badBot).reason).toBe('Slack rejected the bot token: invalid_auth (it is invalid or has been revoked).')
    expect(fake.links).toHaveLength(0)

    bots.targets.set(badApp, eligible(badApp))
    slack.reconcile()
    await until(() => slack.status(badApp).state === 'connected', 'connected with the new token')
  })

  it('ends every connection on close', async () => {
    await setup()
    const ids = [addBot(), addBot()]
    const slack = start()
    await until(() => ids.every(id => slack.status(id).state === 'connected'), 'both connected')
    expect(fake.open()).toHaveLength(2)

    await slack.close()
    await until(() => fake.open().length === 0, 'links to close')
    expect(slack.status(ids[0]!)).toMatchObject({ state: 'disconnected', reasonCode: 'stopped' })
    slack.reconcile()
    expect(fake.links).toHaveLength(2)
  })

  it('hands out a Web API client per bot', async () => {
    await setup()
    const id = addBot()
    const keyless = addBot({ bot: null })
    const slack = start()
    expect(slack.web(keyless)).toBeNull()
    const web = slack.web(id, { fetch: fake.fetch })!
    expect(await web.operations.authTest()).toMatchObject({ teamId: 'T0CANDY', userId: 'U0BOT' })
  })
})
