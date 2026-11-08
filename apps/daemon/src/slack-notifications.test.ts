import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { workspaceNotificationDeliveryPath, workspaceNotificationsPath, type ActivityEvent, type NotificationChannelDescription, type NotificationDeliveryResponse, type NotificationRulesResponse, type Workspace } from '@candy-mountain/platform-sdk'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { absoluteLink, appendActivityEvent, type AppendActivityEventInput, claimNotificationEvent, createActivityEventTypeRegistry, createPluginInstance, declaredActivityEventTypes, DELIVERED_RING_SIZE, fixtureDefinition, fixturePluginType, instanceHarness, type InstanceHarness, isCapabilityDefinition, MasterKey, type NotificationChannel, notificationDeliveredKey, type NotificationDelivery, type NotificationDispatcher, type NotificationDispatcherOptions, notificationRulesKey, platformMeta, openTestDatabase, platformDefinitions, readNotificationRules, startNotificationDispatcher, undescribed } from '@candy-mountain/platform-daemon'
import { createSlackClient, createSlackOperations, slackNotificationChannel, slackPluginType, type SlackClientOptions } from '@candy-mountain/plugin-slack'
import { CAPABILITY_DEFINITIONS, candyMountainWith, createTempDataDir, createTestApp, startTestPlatform } from './testing'
import { bots, botSecretOwner, slackBotSource } from '@candy-mountain/cap-bots'
import { createWorkspaceWithRepository } from '@candy-mountain/plugin-repository'

const WEB_URL = 'http://web.test:4300'
const PLUGIN_TOKEN = 'xoxb-plugin'

interface Call { method: string, token: string, body: Record<string, unknown> }

// Notification kinds of a stand-in capability, so these tests hold whichever product capabilities declare kinds of their own.
const probe = fixtureDefinition('probe', {
  manifest: null,
  activityEventTypes: [
    { id: 'probe.opened', label: 'Probe opened', icon: 'i-lucide-triangle-alert', notifications: [{ id: 'probe.opened', label: 'A probe opens' }] },
    { id: 'probe.closed', label: 'Probe closed', icon: 'i-lucide-circle-check', notifications: [{ id: 'probe.closed', label: 'A probe closes' }] },
  ],
})
const product = candyMountainWith({ capabilities: [...CAPABILITY_DEFINITIONS, probe] })
const harness = (types: Parameters<typeof instanceHarness>[0]) => instanceHarness(types, { product, openDatabase: () => openTestDatabase({ definitions: product.capabilities }), createWorkspace: createWorkspaceWithRepository })
const activityEventTypes = () => createActivityEventTypeRegistry(declaredActivityEventTypes([...platformDefinitions(), ...product.capabilities.filter(isCapabilityDefinition)]))

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
  h = harness([slackPluginType, fixturePluginType('claude-code')])
  return h.createWorkspace('alpha')
}

function slackChannel(scopeUrlPrefix = 'p') {
  const source = slackBotSource(h.deps)
  const slack = {
    source: () => source,
    web(botId: string, clientOptions?: SlackClientOptions) {
      const token = h.store.get(botSecretOwner(botId), 'slackBotToken')
      return token ? { client: createSlackClient(token, clientOptions), operations: createSlackOperations({}, { get: () => token }, clientOptions) } : null
    },
  }
  return slackNotificationChannel({ ...h.deps, slack, scopeUrlPrefix, scopeLabel: CANDY_MOUNTAIN_PRODUCT.scope.label }, { fetch: fakeFetch })
}

/** The dispatcher over the Slack channel the slack definition offers, after any channels given, the way the platform wires it. */
function start(options: NotificationDispatcherOptions = {}, channels: NotificationChannel[] = [], scopeUrlPrefix = 'p') {
  dispatcher = startNotificationDispatcher({ db: h.database.db, channels: [...channels, slackChannel(scopeUrlPrefix)], scopeUrlPrefix, scopeLabel: CANDY_MOUNTAIN_PRODUCT.scope.label }, { webUrl: WEB_URL, log: { error: () => {} }, ...options })
  return dispatcher
}

function addBot(workspace: Workspace, name: string, token: string | null) {
  const id = randomUUID()
  const at = new Date().toISOString()
  h.database.db.insert(bots).values({
    id, projectId: workspace.id, name, family: 'claude-code', writeScope: 'read-only', baseBranch: 'main',
    personaName: 'ana', answersIn: { anywhere: true }, personaStatus: 'verified', createdAt: at, updatedAt: at,
  }).run()
  if (token) h.store.set(botSecretOwner(id), 'slackBotToken', token)
  return id
}

const addPlugin = () => createPluginInstance(h.deps, { type: 'slack', scope: 'global', workspaceId: null, config: {}, secrets: { botToken: PLUGIN_TOKEN } })

const put = (body: unknown, roles?: string[]) =>
  h.app(roles).request(workspaceNotificationsPath('alpha'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = async (roles?: string[]) => (await h.app(roles).request(workspaceNotificationsPath('alpha'))).json() as Promise<NotificationRulesResponse>

const enable = (kind: string, destination: Record<string, string>) => put({ rules: { [kind]: { enabled: true, destination } } })

async function emit(workspace: Workspace, input: Omit<AppendActivityEventInput, 'workspaceId'>): Promise<ActivityEvent> {
  const event = appendActivityEvent(h.database.db, { workspaceId: workspace.id, ...input })
  await dispatcher!.idle()
  return event
}

const posts = () => calls.filter(c => c.method === 'chat.postMessage')

describe('notification rules over REST', () => {
  it('starts with every kind off and persists updates in platform_meta', async () => {
    const workspace = await setup()
    const empty = await get()
    expect(Object.keys(empty.rules).sort()).toEqual(empty.kinds.map(k => k.id).sort())
    expect(empty.kinds).toEqual(expect.arrayContaining([
      { id: 'bot.finished', label: 'A bot finishes' },
      { id: 'probe.opened', label: 'A probe opens' },
      { id: 'probe.closed', label: 'A probe closes' },
    ]))
    expect(empty.rules['bot.finished']).toEqual({ enabled: false, destination: null, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null })

    const res = await enable('bot.finished', { memberId: 'U123' })
    expect(res.status).toBe(200)
    const saved = await res.json() as NotificationRulesResponse
    expect(saved.rules['bot.finished']).toMatchObject({ enabled: true, destination: { memberId: 'U123' } })
    expect(saved.rules['probe.opened']!.enabled).toBe(false)
    expect(JSON.parse(h.database.db.select().from(platformMeta).where(eq(platformMeta.key, notificationRulesKey(workspace.id))).get()!.value)).toMatchObject({ 'bot.finished': { enabled: true } })

    const merged = await (await put({ rules: { 'probe.opened': { enabled: true, destination: { channelId: 'C999' } }, 'bot.finished': { enabled: false } } })).json() as NotificationRulesResponse
    expect(merged.rules['bot.finished']).toMatchObject({ enabled: false, destination: { memberId: 'U123' } })
    expect(merged.rules['probe.opened']).toMatchObject({ enabled: true, destination: { channelId: 'C999' } })
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
    expect((await h.app().request(workspaceNotificationsPath('alpha'), { method: 'PUT', body: '{nope' })).status).toBe(400)
    expect((await put({ rules: {} }, ['developer'])).status).toBe(403)
    expect((await h.app(['developer']).request(workspaceNotificationsPath('alpha'))).status).toBe(403)
    expect((await h.app().request(workspaceNotificationsPath('missing'))).status).toBe(404)
  })
})

describe('notification delivery over REST', () => {
  const delivery = async (channels: NotificationChannel[], roles?: string[]) => {
    const res = await h.app(roles, { notificationChannels: channels }).request(workspaceNotificationDeliveryPath('alpha'))
    return { status: res.status, body: await res.json() as NotificationDeliveryResponse }
  }
  const pager = (sender: string | null): NotificationChannel => ({
    id: 'pager',
    deliver: async () => sender !== null,
    describe: (): NotificationChannelDescription => ({ label: 'Pager', sender, setupHelp: 'Add a pager.', setup: { label: 'Set up paging', link: '/pager' }, destinations: { channel: { label: 'Rota', placeholder: 'R1', help: '', pattern: '^R', mismatch: 'Not a rota.' }, member: { label: 'Person', placeholder: 'P1', help: '', pattern: '^P', mismatch: 'Not a person.' } } }),
  })

  it('answers no channel when no capability offers one', async () => {
    await setup()
    expect((await delivery([])).body).toEqual({ channels: [], activeChannelId: null })
  })

  it('describes Slack with no identity, then through the platform plugin, then through the first bot with a token', async () => {
    const workspace = await setup()
    const none = (await delivery([slackChannel()])).body
    expect(none.activeChannelId).toBeNull()
    expect(none.channels).toEqual([expect.objectContaining({
      id: 'slack',
      label: 'Slack',
      sender: null,
      setupHelp: 'Add a Slack bot token to one of this project\'s bots, or configure the Slack plugin.',
      setup: { label: 'Set up Slack', link: '/p/alpha/setup/plugins' },
    })])
    expect(none.channels[0]!.destinations.channel).toMatchObject({ placeholder: 'C0123ABCD', pattern: '^[CG][A-Z0-9]{2,}$' })
    expect(none.channels[0]!.destinations.member).toMatchObject({ placeholder: 'U0123ABCD', pattern: '^[UW][A-Z0-9]{2,}$' })

    addBot(workspace, 'keyless', null)
    addPlugin()
    const plugin = (await delivery([slackChannel()])).body
    expect(plugin).toMatchObject({ activeChannelId: 'slack', channels: [{ sender: 'Platform Slack plugin' }] })

    addBot(workspace, 'zed', 'xoxb-zed')
    addBot(workspace, 'Bea', 'xoxb-bea')
    expect((await delivery([slackChannel('w')])).body).toMatchObject({ activeChannelId: 'slack', channels: [{ sender: 'Project bot Bea', setup: { link: '/w/alpha/setup/plugins' } }] })
  })

  it('names the first channel with a sender as the active one, in dispatch order', async () => {
    await setup()
    expect((await delivery([pager(null), slackChannel()])).body.activeChannelId).toBeNull()
    addPlugin()
    expect((await delivery([pager(null), slackChannel()])).body.activeChannelId).toBe('slack')
    const both = (await delivery([pager('Rota bot'), slackChannel()])).body
    expect(both.activeChannelId).toBe('pager')
    expect(both.channels.map(c => [c.id, c.sender])).toEqual([['pager', 'Rota bot'], ['slack', 'Platform Slack plugin']])
  })

  it('is admin only and 404s an unknown workspace', async () => {
    await setup()
    expect((await delivery([], ['developer'])).status).toBe(403)
    expect((await h.app().request(workspaceNotificationDeliveryPath('missing'))).status).toBe(404)
  })
})

describe('notification dispatcher', () => {
  it('maps activity events to notification kinds', () => {
    const { notificationKindOf } = activityEventTypes()
    expect(notificationKindOf({ type: 'bot.handoff', payload: null })).toBe('bot.finished')
    expect(notificationKindOf({ type: 'probe.opened', payload: null })).toBe('probe.opened')
    expect(notificationKindOf({ type: 'probe.closed', payload: null })).toBe('probe.closed')
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
    const workspace = await setup()
    const botId = addBot(workspace, 'ana', 'xoxb-bot')
    addPlugin()
    await enable('bot.finished', { memberId: 'U123' })
    start()

    await emit(workspace, { type: 'bot.handoff', title: 'Ana finished: fix <login> & logout', link: '/p/alpha/agents/t1', payload: { outcome: 'done' } })

    expect(calls.map(c => c.method)).toEqual(['conversations.open', 'chat.postMessage'])
    expect(calls.every(c => c.token === 'xoxb-bot')).toBe(true)
    expect(calls[0]!.body).toEqual({ users: 'U123' })
    expect(posts()[0]!.body).toEqual({ channel: 'D-U123', text: 'Ana finished: fix &lt;login&gt; &amp; logout\n<http://web.test:4300/p/alpha/agents/t1|Open in Candy Mountain>' })
    const rule = (await get()).rules['bot.finished']!
    expect(rule.lastDeliveredAt).toEqual(expect.any(String))
    expect(rule.lastFailureAt).toBeNull()
    expect(h.store.get(botSecretOwner(botId), 'slackBotToken')).toBe('xoxb-bot')
  })

  it('tries the channels the definitions offer in order and falls back to Slack only when none accepts', async () => {
    const workspace = await setup()
    addPlugin()
    await enable('probe.opened', { channelId: 'C777' })
    await enable('probe.closed', { channelId: 'C777' })
    const seen: string[] = []
    const declines = {
      id: 'pager',
      describe: undescribed,
      async deliver(d: NotificationDelivery) {
        seen.push(`pager ${d.kind}`)
        return false
      },
    }
    const accepts = {
      id: 'mail',
      describe: undescribed,
      async deliver(d: NotificationDelivery) {
        seen.push(`mail ${d.kind} ${d.url}`)
        return d.kind === 'probe.opened'
      },
    }
    start({}, [declines, accepts])

    await emit(workspace, { type: 'probe.opened', title: 'API down', link: '/p/alpha/probe' })
    await emit(workspace, { type: 'probe.closed', title: 'API back' })

    expect(seen).toEqual(['pager probe.opened', `mail probe.opened ${WEB_URL}/p/alpha/probe`, 'pager probe.closed', `mail probe.closed ${WEB_URL}/p/alpha`])
    expect(calls).toEqual([{ method: 'chat.postMessage', token: PLUGIN_TOKEN, body: { channel: 'C777', text: `API back\n<${WEB_URL}/p/alpha|Open in Candy Mountain>` } }])
    const rules = (await get()).rules
    expect(rules['probe.opened']!.lastDeliveredAt).toEqual(expect.any(String))
    expect(rules['probe.closed']!.lastDeliveredAt).toEqual(expect.any(String))
  })

  it('posts an opened probe to the configured channel through the platform plugin when no bot has keys', async () => {
    const workspace = await setup()
    addBot(workspace, 'keyless', null)
    addPlugin()
    await enable('probe.opened', { channelId: 'C777' })
    start()

    await emit(workspace, { type: 'probe.opened', title: 'API down', link: '/p/alpha/probe' })
    await emit(workspace, { type: 'probe.closed', title: 'API back' })

    expect(calls).toEqual([{ method: 'chat.postMessage', token: PLUGIN_TOKEN, body: { channel: 'C777', text: 'API down\n<http://web.test:4300/p/alpha/probe|Open in Candy Mountain>' } }])
  })

  it('prefers the first bot with Slack keys over later bots and over the plugin, and falls back to the workspace page without a link', async () => {
    const workspace = await setup()
    addBot(workspace, 'zed', 'xoxb-zed')
    addBot(workspace, 'bea', 'xoxb-bea')
    addBot(workspace, 'ada', null)
    addPlugin()
    await enable('deploy.failed', { channelId: 'C100' })
    start()

    await emit(workspace, { type: 'deploy.attempted', title: 'Deploy failed', payload: { outcome: 'failed' } })
    await emit(workspace, { type: 'deploy.attempted', title: 'Deploy ok', payload: { outcome: 'succeeded' } })

    expect(posts()).toEqual([{ method: 'chat.postMessage', token: 'xoxb-bea', body: { channel: 'C100', text: 'Deploy failed\n<http://web.test:4300/p/alpha|Open in Candy Mountain>' } }])
  })

  it('falls back to the workspace page under the product\'s scope prefix', async () => {
    const workspace = await setup()
    await enable('probe.closed', { channelId: 'C777' })
    const urls: string[] = []
    start({}, [{ id: 'mail', deliver: async (d: NotificationDelivery) => Boolean(urls.push(d.url)), describe: undescribed }], 'w')

    await emit(workspace, { type: 'probe.closed', title: 'API back' })

    expect(urls).toEqual([`${WEB_URL}/w/alpha`])
  })

  it('records a delivery failure on the rule when no channel has an identity, and keeps going', async () => {
    const workspace = await setup()
    addBot(workspace, 'keyless', null)
    await enable('probe.opened', { channelId: 'C100' })
    await enable('probe.closed', { channelId: 'C100' })
    start()

    await emit(workspace, { type: 'probe.opened', title: 'down' })
    const after = (await get()).rules
    expect(after['probe.opened']).toMatchObject({ lastFailureAt: expect.any(String), lastFailureReason: 'No delivery channel: slack has no identity for this project.', lastDeliveredAt: null })
    expect(after['probe.closed']!.lastFailureAt).toBeNull()
    expect(calls).toEqual([])

    await emit(workspace, { type: 'probe.closed', title: 'up' })
    expect((await get()).rules['probe.closed']!.lastFailureReason).toMatch(/No delivery channel/)

    addPlugin()
    await emit(workspace, { type: 'probe.closed', title: 'up again' })
    expect((await get()).rules['probe.closed']).toMatchObject({ lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: expect.any(String) })

    await enable('probe.opened', { channelId: 'C200' })
    expect((await get()).rules['probe.opened']).toMatchObject({ lastFailureAt: null, lastFailureReason: null })
  })

  it('records Slack errors with their reason', async () => {
    const workspace = await setup()
    addPlugin()
    await enable('probe.opened', { channelId: 'C100' })
    failures.set('chat.postMessage', 'channel_not_found')
    start()

    await emit(workspace, { type: 'probe.opened', title: 'down' })
    expect((await get()).rules['probe.opened']!.lastFailureReason).toMatch(/channel_not_found/)
    expect((await get()).rules['probe.opened']!.lastFailureReason).not.toContain(PLUGIN_TOKEN)
  })

  it('never sends twice for one event, even across dispatcher restarts', async () => {
    const workspace = await setup()
    addPlugin()
    await enable('bot.finished', { memberId: 'U100' })
    const first = start()

    const event = await emit(workspace, { type: 'bot.handoff', title: 'done' })
    first.notify(event)
    first.notify({ ...event })
    await first.idle()
    expect(posts()).toHaveLength(1)

    first.close()
    const second = start()
    second.notify(event)
    await second.idle()
    expect(posts()).toHaveLength(1)
    const ring = JSON.parse(h.database.db.select().from(platformMeta).where(eq(platformMeta.key, notificationDeliveredKey(workspace.id))).get()!.value) as string[]
    expect(ring).toEqual([event.id])
  })

  it('forgets the oldest delivered ids beyond the ring size', async () => {
    const workspace = await setup()
    for (let i = 0; i < DELIVERED_RING_SIZE + 5; i++) claimNotificationEvent(h.database.db, workspace.id, `e${i}`)
    expect(claimNotificationEvent(h.database.db, workspace.id, 'e0')).toBe(true)
    expect(claimNotificationEvent(h.database.db, workspace.id, `e${DELIVERED_RING_SIZE + 4}`)).toBe(false)
  })

  it('ignores disabled rules, unmatched events and events after close, and leaves them unclaimed', async () => {
    const workspace = await setup()
    addPlugin()
    await put({ rules: { 'bot.finished': { enabled: false, destination: { memberId: 'U100' } }, 'deploy.succeeded': { enabled: true, destination: { channelId: 'C100' } } } })
    const d = start()

    await emit(workspace, { type: 'bot.handoff', title: 'off' })
    await emit(workspace, { type: 'session.started', title: 'no kind' })
    await emit(workspace, { type: 'deploy.attempted', title: 'no outcome' })
    expect(calls).toEqual([])
    expect(h.database.db.select().from(platformMeta).where(eq(platformMeta.key, notificationDeliveredKey(workspace.id))).get()).toBeUndefined()

    d.close()
    appendActivityEvent(h.database.db, { workspaceId: workspace.id, type: 'deploy.attempted', title: 'late', payload: { outcome: 'succeeded' } })
    await d.idle()
    expect(calls).toEqual([])
  })

  it('does not hear appends on another platform database', async () => {
    await setup()
    addPlugin()
    await enable('probe.opened', { channelId: 'C100' })
    start()
    const other = harness([slackPluginType])
    try {
      const workspace = await other.createWorkspace('alpha')
      appendActivityEvent(other.database.db, { workspaceId: workspace.id, type: 'probe.opened', title: 'elsewhere' })
      await dispatcher!.idle()
      expect(calls).toEqual([])
    }
    finally {
      other.close()
    }
  })

  it('reads rules straight from storage with defaults for anything missing or malformed', async () => {
    const workspace = await setup()
    h.database.db.insert(platformMeta).values({ key: notificationRulesKey(workspace.id), value: '{"bot.finished":{"enabled":true,"destination":{"channelId":"C100"}},"deploy.failed":"junk"}', updatedAt: 'x' }).run()
    const rules = readNotificationRules(h.database.db, workspace.id)
    expect(rules['bot.finished']).toEqual({ enabled: true, destination: { channelId: 'C100' }, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null })
    expect(rules['deploy.failed']!.enabled).toBe(false)
    h.database.db.update(platformMeta).set({ value: 'not json' }).where(eq(platformMeta.key, notificationRulesKey(workspace.id))).run()
    expect(readNotificationRules(h.database.db, workspace.id)['bot.finished']!.enabled).toBe(false)
  })
})

describe('platform wiring', () => {
  it('offers only the kinds its capabilities declare and keeps stored rules for the rest', async () => {
    const dir = createTempDataDir()
    const platform = startTestPlatform(dir.root, { secretsKey: MasterKey.generate(), notifications: { webUrl: WEB_URL, log: { error: () => {} } } })
    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-kinds-'))
    try {
      expect(platform.activityEventTypes.list()).toEqual(expect.arrayContaining(['session.started', 'run.started', 'bot.handoff']))
      expect(platform.activityEventTypes.list()).not.toContain('probe.opened')
      const workspace = await createWorkspaceWithRepository(platform.db, { name: 'alpha', path: checkout })
      const stored = { enabled: true, destination: { channelId: 'C100' }, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null }
      platform.db.insert(platformMeta).values({ key: notificationRulesKey(workspace.id), value: JSON.stringify({ 'probe.opened': stored }), updatedAt: 'x' }).run()

      const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, pluginTypes: platform.pluginTypes, families: platform.families, product: platform.product, runtime: platform.runtime })
      const read = await (await app.request(workspaceNotificationsPath('alpha'))).json() as NotificationRulesResponse
      expect(read.kinds.map(k => k.id)).toContain('bot.finished')
      expect(read.kinds.map(k => k.id)).not.toContain('probe.opened')
      expect(Object.keys(read.rules)).toEqual(read.kinds.map(k => k.id))
      const answer = await (await app.request(workspaceNotificationDeliveryPath('alpha'))).json() as NotificationDeliveryResponse
      expect(answer).toMatchObject({ activeChannelId: null, channels: [{ id: 'slack', sender: null, setup: { link: '/p/alpha/setup/plugins' } }] })
      const refused = await app.request(workspaceNotificationsPath('alpha'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { 'probe.opened': { enabled: false } } }) })
      expect(refused.status).toBe(400)

      const saved = await app.request(workspaceNotificationsPath('alpha'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { 'bot.finished': { enabled: true, destination: { memberId: 'U100' } } } }) })
      expect(saved.status).toBe(200)
      expect(JSON.parse(platform.db.select().from(platformMeta).where(eq(platformMeta.key, notificationRulesKey(workspace.id))).get()!.value)).toMatchObject({ 'probe.opened': stored, 'bot.finished': { enabled: true } })
    }
    finally {
      await platform.close()
      rmSync(checkout, { recursive: true, force: true })
      dir.cleanup()
    }
  })

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
