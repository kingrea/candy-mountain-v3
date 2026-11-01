import { randomUUID } from 'node:crypto'
import { projectNotificationsPath, type ActivityEvent, type NotificationRulesResponse, type Project } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { appendActivityEvent, type AppendActivityEventInput } from '../activity/events'
import { botSecretOwner } from '../bots'
import { bots, platformMeta } from '../db/schema'
import { fixturePluginType } from '../plugins/fixtures'
import { createPluginInstance } from '../plugins/instances/instances'
import { instanceHarness, type InstanceHarness } from '../plugins/instances/test-support'
import { createSlackClient, createSlackOperations, slackPluginType, type SlackClientOptions } from '../plugins/slack'
import type { NotificationChannel, NotificationDelivery } from '../capabilities/definition'
import { startTestPlatform } from '../testing/platform'
import { MasterKey } from '../secrets'
import { slackNotificationChannel } from '../slack/notifications'
import { createTempDataDir } from '../testing'
import { absoluteLink, notificationKindOf, startNotificationDispatcher, type NotificationDispatcher, type NotificationDispatcherOptions } from './dispatcher'
import { claimNotificationEvent, DELIVERED_RING_SIZE, notificationDeliveredKey, notificationRulesKey, readNotificationRules } from './rules'

const WEB_URL = 'http://web.test:4300'
const PLUGIN_TOKEN = 'xoxb-plugin'

interface Call { method: string, token: string, body: Record<string, unknown> }

let h: InstanceHarness
let dispatcher: NotificationDispatcher | undefined
const calls: Call[] = []
const failures = new Map<string, string>()

afterEach(() => {
  dispatcher?.close()
  dispatcher = undefined
  h?.close()
  calls.length = 0
  failures.clear()
})

const fakeFetch: typeof fetch = async (input, init) => {
  const method = String(input).split('/').at(-1)!
  const token = String(new Headers(init?.headers).get('authorization')).replace('Bearer ', '')
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  calls.push({ method, token, body })
  const error = failures.get(method)
  if (error) return Response.json({ ok: false, error })
  if (method === 'conversations.open') return Response.json({ ok: true, channel: { id: `D-${body.users}` } })
  if (method === 'chat.postMessage') return Response.json({ ok: true, channel: body.channel, ts: '1.2' })
  return Response.json({ ok: false, error: 'unknown_method' })
}

function setup() {
  h = instanceHarness([slackPluginType, fixturePluginType('claude-code')])
  return h.createProject('alpha')
}

/** The dispatcher over the Slack channel the slack definition offers, after any channels given, the way the platform wires it. */
function start(options: NotificationDispatcherOptions = {}, channels: NotificationChannel[] = [], scopeUrlPrefix = 'p') {
  const slack = {
    web(botId: string, clientOptions?: SlackClientOptions) {
      const token = h.store.get(botSecretOwner(botId), 'slackBotToken')
      return token ? { client: createSlackClient(token, clientOptions), operations: createSlackOperations({}, { get: () => token }, clientOptions) } : null
    },
  }
  dispatcher = startNotificationDispatcher({ db: h.database.db, channels: [...channels, slackNotificationChannel({ ...h.deps, slack }, { fetch: fakeFetch })], scopeUrlPrefix }, { webUrl: WEB_URL, log: { error: () => {} }, ...options })
  return dispatcher
}

function addBot(project: Project, name: string, token: string | null) {
  const id = randomUUID()
  const at = new Date().toISOString()
  h.database.db.insert(bots).values({
    id, projectId: project.id, name, family: 'claude-code', writeScope: 'read-only', baseBranch: 'main',
    personaName: 'ana', answersIn: { anywhere: true }, personaStatus: 'verified', createdAt: at, updatedAt: at,
  }).run()
  if (token) h.store.set(botSecretOwner(id), 'slackBotToken', token)
  return id
}

const addPlugin = () => createPluginInstance(h.deps, { type: 'slack', scope: 'global', projectId: null, config: {}, secrets: { botToken: PLUGIN_TOKEN } })

const put = (body: unknown, roles?: string[]) =>
  h.app(roles).request(projectNotificationsPath('alpha'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = async (roles?: string[]) => (await h.app(roles).request(projectNotificationsPath('alpha'))).json() as Promise<NotificationRulesResponse>

const enable = (kind: string, destination: Record<string, string>) => put({ rules: { [kind]: { enabled: true, destination } } })

async function emit(project: Project, input: Omit<AppendActivityEventInput, 'projectId'>): Promise<ActivityEvent> {
  const event = appendActivityEvent(h.database.db, { projectId: project.id, ...input })
  await dispatcher!.idle()
  return event
}

const posts = () => calls.filter(c => c.method === 'chat.postMessage')

describe('notification rules over REST', () => {
  it('starts with every kind off and persists updates in platform_meta', async () => {
    const project = await setup()
    const empty = await get()
    expect(Object.keys(empty.rules).sort()).toEqual(['bot.finished', 'deploy.failed', 'deploy.succeeded', 'incident.closed', 'incident.opened'])
    expect(empty.rules['bot.finished']).toEqual({ enabled: false, destination: null, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null })

    const res = await enable('bot.finished', { memberId: 'U123' })
    expect(res.status).toBe(200)
    const saved = await res.json() as NotificationRulesResponse
    expect(saved.rules['bot.finished']).toMatchObject({ enabled: true, destination: { memberId: 'U123' } })
    expect(saved.rules['incident.opened'].enabled).toBe(false)
    expect(JSON.parse(h.database.db.select().from(platformMeta).where(eq(platformMeta.key, notificationRulesKey(project.id))).get()!.value)).toMatchObject({ 'bot.finished': { enabled: true } })

    const merged = await (await put({ rules: { 'incident.opened': { enabled: true, destination: { channelId: 'C999' } }, 'bot.finished': { enabled: false } } })).json() as NotificationRulesResponse
    expect(merged.rules['bot.finished']).toMatchObject({ enabled: false, destination: { memberId: 'U123' } })
    expect(merged.rules['incident.opened']).toMatchObject({ enabled: true, destination: { channelId: 'C999' } })
    expect((await get()).rules).toEqual(merged.rules)
  })

  it('validates the body, the kind, the destination and the caller', async () => {
    await setup()
    const code = async (body: unknown) => {
      const res = await put(body)
      expect(res.status).toBe(400)
      return ((await res.json()) as { error: { code: string, message: string } }).error
    }
    expect((await code({})).code).toBe('invalid_request')
    expect((await code({ rules: { nope: { enabled: true } } })).message).toMatch(/Unknown notification kind/)
    expect((await code({ rules: { 'bot.finished': { enabled: true } } })).message).toMatch(/needs a destination/)
    expect((await code({ rules: { 'bot.finished': { enabled: 'yes' } } })).message).toMatch(/boolean/)
    expect((await code({ rules: { 'bot.finished': { destination: { channelId: 'C100', memberId: 'U100' } } } })).message).toMatch(/not both/)
    expect((await code({ rules: { 'bot.finished': { destination: { channelId: 'general' } } } })).message).toMatch(/not a Slack channel id/)
    expect((await code({ rules: { 'bot.finished': { destination: { memberId: 'jack' } } } })).message).toMatch(/not a Slack member id/)
    expect((await code({ rules: { 'bot.finished': { destination: {} } } })).message).toMatch(/channelId or a memberId/)
    expect((await h.app().request(projectNotificationsPath('alpha'), { method: 'PUT', body: '{nope' })).status).toBe(400)
    expect((await put({ rules: {} }, ['developer'])).status).toBe(403)
    expect((await h.app(['developer']).request(projectNotificationsPath('alpha'))).status).toBe(403)
    expect((await h.app().request(projectNotificationsPath('missing'))).status).toBe(404)
  })
})

describe('notification dispatcher', () => {
  it('maps activity events to notification kinds', () => {
    expect(notificationKindOf({ type: 'bot.handoff', payload: null })).toBe('bot.finished')
    expect(notificationKindOf({ type: 'incident.opened', payload: null })).toBe('incident.opened')
    expect(notificationKindOf({ type: 'incident.closed', payload: null })).toBe('incident.closed')
    expect(notificationKindOf({ type: 'deploy.attempted', payload: { outcome: 'succeeded' } })).toBe('deploy.succeeded')
    expect(notificationKindOf({ type: 'deploy.attempted', payload: { outcome: 'failed' } })).toBe('deploy.failed')
    expect(notificationKindOf({ type: 'deploy.attempted', payload: { outcome: 'pending' } })).toBeNull()
    expect(notificationKindOf({ type: 'deploy.attempted', payload: null })).toBeNull()
    expect(notificationKindOf({ type: 'session.started', payload: null })).toBeNull()
    expect(notificationKindOf({ type: 'run.started', payload: null })).toBeNull()
    expect(absoluteLink('http://x/', '/p/a')).toBe('http://x/p/a')
    expect(absoluteLink('http://x', 'p/a')).toBe('http://x/p/a')
  })

  it('sends one direct message with a link to the thread when a bot finishes, through the bot token', async () => {
    const project = await setup()
    const botId = addBot(project, 'ana', 'xoxb-bot')
    addPlugin()
    await enable('bot.finished', { memberId: 'U123' })
    start()

    await emit(project, { type: 'bot.handoff', title: 'Ana finished: fix <login> & logout', link: '/p/alpha/agents/t1', payload: { outcome: 'done' } })

    expect(calls.map(c => c.method)).toEqual(['conversations.open', 'chat.postMessage'])
    expect(calls.every(c => c.token === 'xoxb-bot')).toBe(true)
    expect(calls[0]!.body).toEqual({ users: 'U123' })
    expect(posts()[0]!.body).toEqual({ channel: 'D-U123', text: 'Ana finished: fix &lt;login&gt; &amp; logout\n<http://web.test:4300/p/alpha/agents/t1|Open in Candy Mountain>' })
    const rule = (await get()).rules['bot.finished']
    expect(rule.lastDeliveredAt).toEqual(expect.any(String))
    expect(rule.lastFailureAt).toBeNull()
    expect(h.store.get(botSecretOwner(botId), 'slackBotToken')).toBe('xoxb-bot')
  })

  it('tries the channels the definitions offer in order and falls back to Slack only when none accepts', async () => {
    const project = await setup()
    addPlugin()
    await enable('incident.opened', { channelId: 'C777' })
    await enable('incident.closed', { channelId: 'C777' })
    const seen: string[] = []
    const declines = {
      id: 'pager',
      async deliver(d: NotificationDelivery) {
        seen.push(`pager ${d.kind}`)
        return false
      },
    }
    const accepts = {
      id: 'mail',
      async deliver(d: NotificationDelivery) {
        seen.push(`mail ${d.kind} ${d.url}`)
        return d.kind === 'incident.opened'
      },
    }
    start({}, [declines, accepts])

    await emit(project, { type: 'incident.opened', title: 'API down', link: '/p/alpha/uptime' })
    await emit(project, { type: 'incident.closed', title: 'API back' })

    expect(seen).toEqual(['pager incident.opened', `mail incident.opened ${WEB_URL}/p/alpha/uptime`, 'pager incident.closed', `mail incident.closed ${WEB_URL}/p/alpha`])
    expect(calls).toEqual([{ method: 'chat.postMessage', token: PLUGIN_TOKEN, body: { channel: 'C777', text: `API back\n<${WEB_URL}/p/alpha|Open in Candy Mountain>` } }])
    const rules = (await get()).rules
    expect(rules['incident.opened'].lastDeliveredAt).toEqual(expect.any(String))
    expect(rules['incident.closed'].lastDeliveredAt).toEqual(expect.any(String))
  })

  it('posts an opened incident to the configured channel through the platform plugin when no bot has keys', async () => {
    const project = await setup()
    addBot(project, 'keyless', null)
    addPlugin()
    await enable('incident.opened', { channelId: 'C777' })
    start()

    await emit(project, { type: 'incident.opened', title: 'API down', link: '/p/alpha/uptime' })
    await emit(project, { type: 'incident.closed', title: 'API back' })

    expect(calls).toEqual([{ method: 'chat.postMessage', token: PLUGIN_TOKEN, body: { channel: 'C777', text: 'API down\n<http://web.test:4300/p/alpha/uptime|Open in Candy Mountain>' } }])
  })

  it('prefers the first bot with Slack keys over later bots and over the plugin, and falls back to the project page without a link', async () => {
    const project = await setup()
    addBot(project, 'zed', 'xoxb-zed')
    addBot(project, 'bea', 'xoxb-bea')
    addBot(project, 'ada', null)
    addPlugin()
    await enable('deploy.failed', { channelId: 'C100' })
    start()

    await emit(project, { type: 'deploy.attempted', title: 'Deploy failed', payload: { outcome: 'failed' } })
    await emit(project, { type: 'deploy.attempted', title: 'Deploy ok', payload: { outcome: 'succeeded' } })

    expect(posts()).toEqual([{ method: 'chat.postMessage', token: 'xoxb-bea', body: { channel: 'C100', text: 'Deploy failed\n<http://web.test:4300/p/alpha|Open in Candy Mountain>' } }])
  })

  it('falls back to the project page under the product\'s scope prefix', async () => {
    const project = await setup()
    await enable('incident.closed', { channelId: 'C777' })
    const urls: string[] = []
    start({}, [{ id: 'mail', deliver: async (d: NotificationDelivery) => Boolean(urls.push(d.url)) }], 'w')

    await emit(project, { type: 'incident.closed', title: 'API back' })

    expect(urls).toEqual([`${WEB_URL}/w/alpha`])
  })

  it('records a delivery failure on the rule when no channel has an identity, and keeps going', async () => {
    const project = await setup()
    addBot(project, 'keyless', null)
    await enable('incident.opened', { channelId: 'C100' })
    await enable('incident.closed', { channelId: 'C100' })
    start()

    await emit(project, { type: 'incident.opened', title: 'down' })
    const after = (await get()).rules
    expect(after['incident.opened']).toMatchObject({ lastFailureAt: expect.any(String), lastFailureReason: 'No delivery channel: slack has no identity for this project.', lastDeliveredAt: null })
    expect(after['incident.closed'].lastFailureAt).toBeNull()
    expect(calls).toEqual([])

    await emit(project, { type: 'incident.closed', title: 'up' })
    expect((await get()).rules['incident.closed'].lastFailureReason).toMatch(/No delivery channel/)

    addPlugin()
    await emit(project, { type: 'incident.closed', title: 'up again' })
    expect((await get()).rules['incident.closed']).toMatchObject({ lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: expect.any(String) })

    await enable('incident.opened', { channelId: 'C200' })
    expect((await get()).rules['incident.opened']).toMatchObject({ lastFailureAt: null, lastFailureReason: null })
  })

  it('records Slack errors with their reason', async () => {
    const project = await setup()
    addPlugin()
    await enable('incident.opened', { channelId: 'C100' })
    failures.set('chat.postMessage', 'channel_not_found')
    start()

    await emit(project, { type: 'incident.opened', title: 'down' })
    expect((await get()).rules['incident.opened'].lastFailureReason).toMatch(/channel_not_found/)
    expect((await get()).rules['incident.opened'].lastFailureReason).not.toContain(PLUGIN_TOKEN)
  })

  it('never sends twice for one event, even across dispatcher restarts', async () => {
    const project = await setup()
    addPlugin()
    await enable('bot.finished', { memberId: 'U100' })
    const first = start()

    const event = await emit(project, { type: 'bot.handoff', title: 'done' })
    first.notify(event)
    first.notify({ ...event })
    await first.idle()
    expect(posts()).toHaveLength(1)

    first.close()
    const second = start()
    second.notify(event)
    await second.idle()
    expect(posts()).toHaveLength(1)
    const ring = JSON.parse(h.database.db.select().from(platformMeta).where(eq(platformMeta.key, notificationDeliveredKey(project.id))).get()!.value) as string[]
    expect(ring).toEqual([event.id])
  })

  it('forgets the oldest delivered ids beyond the ring size', async () => {
    const project = await setup()
    for (let i = 0; i < DELIVERED_RING_SIZE + 5; i++) claimNotificationEvent(h.database.db, project.id, `e${i}`)
    expect(claimNotificationEvent(h.database.db, project.id, 'e0')).toBe(true)
    expect(claimNotificationEvent(h.database.db, project.id, `e${DELIVERED_RING_SIZE + 4}`)).toBe(false)
  })

  it('ignores disabled rules, unmatched events and events after close, and leaves them unclaimed', async () => {
    const project = await setup()
    addPlugin()
    await put({ rules: { 'bot.finished': { enabled: false, destination: { memberId: 'U100' } }, 'deploy.succeeded': { enabled: true, destination: { channelId: 'C100' } } } })
    const d = start()

    await emit(project, { type: 'bot.handoff', title: 'off' })
    await emit(project, { type: 'session.started', title: 'no kind' })
    await emit(project, { type: 'deploy.attempted', title: 'no outcome' })
    expect(calls).toEqual([])
    expect(h.database.db.select().from(platformMeta).where(eq(platformMeta.key, notificationDeliveredKey(project.id))).get()).toBeUndefined()

    d.close()
    appendActivityEvent(h.database.db, { projectId: project.id, type: 'deploy.attempted', title: 'late', payload: { outcome: 'succeeded' } })
    await d.idle()
    expect(calls).toEqual([])
  })

  it('does not hear appends on another platform database', async () => {
    await setup()
    addPlugin()
    await enable('incident.opened', { channelId: 'C100' })
    start()
    const other = instanceHarness([slackPluginType])
    try {
      const project = await other.createProject('alpha')
      appendActivityEvent(other.database.db, { projectId: project.id, type: 'incident.opened', title: 'elsewhere' })
      await dispatcher!.idle()
      expect(calls).toEqual([])
    }
    finally {
      other.close()
    }
  })

  it('reads rules straight from storage with defaults for anything missing or malformed', async () => {
    const project = await setup()
    h.database.db.insert(platformMeta).values({ key: notificationRulesKey(project.id), value: '{"bot.finished":{"enabled":true,"destination":{"channelId":"C100"}},"deploy.failed":"junk"}', updatedAt: 'x' }).run()
    const rules = readNotificationRules(h.database.db, project.id)
    expect(rules['bot.finished']).toEqual({ enabled: true, destination: { channelId: 'C100' }, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null })
    expect(rules['deploy.failed'].enabled).toBe(false)
    h.database.db.update(platformMeta).set({ value: 'not json' }).where(eq(platformMeta.key, notificationRulesKey(project.id))).run()
    expect(readNotificationRules(h.database.db, project.id)['bot.finished'].enabled).toBe(false)
  })
})

describe('platform wiring', () => {
  it('starts the dispatcher with the platform and stops it on close', async () => {
    const dir = createTempDataDir()
    const platform = startTestPlatform(dir.root, { secretsKey: MasterKey.generate(), notifications: { webUrl: WEB_URL, log: { error: () => {} } } })
    try {
      expect(platform.notifications).toBeDefined()
      await platform.notifications.idle()
    }
    finally {
      platform.close()
      dir.cleanup()
    }
  })
})
