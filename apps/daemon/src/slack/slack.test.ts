import { randomUUID } from 'node:crypto'
import { botSlackConnectionPath, type Actor, type BotSlackConnectionResponse, type BotPersonaStatus, type Project } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/platform'
import { botSecretOwner } from '../bots'
import { bots, projects } from '../db/schema'
import { fixturePluginType } from '../plugins/fixtures'
import { createPluginInstance, testPluginInstance } from '../plugins/instances/instances'
import { instanceHarness, type InstanceHarness } from '../plugins/instances/test-support'
import type { SlackBotEvent } from './events'
import { nextEnvelopeId, startFakeSocketMode, type FakeSocketMode } from './fake-socket-mode'
import { startSlackConnections, type SlackConnections, type SlackConnectionsOptions } from './manager'
import { slackRoutes } from './routes'

const APP_TOKEN = 'xapp-1-valid'
const BOT_TOKEN = 'xoxb-valid'

let h: InstanceHarness
let fake: FakeSocketMode
let manager: SlackConnections | undefined
const errors: unknown[][] = []

afterEach(async () => {
  await manager?.close()
  manager = undefined
  await fake?.close()
  h?.close()
  errors.length = 0
})

async function until(check: () => boolean, what: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function setup(): Promise<Project> {
  h = instanceHarness([fixturePluginType('claude-code')])
  fake = await startFakeSocketMode()
  fake.validAppTokens.add(APP_TOKEN)
  fake.validBotTokens.add(BOT_TOKEN)
  const project = await h.createProject('alpha')
  const instance = createPluginInstance(h.deps, { type: 'claude-code', scope: 'project', projectId: project.id, config: { account: 'jack' }, secrets: { token: 't' } })
  await testPluginInstance(h.deps, instance.id)
  return project
}

function start(options: SlackConnectionsOptions = {}) {
  manager = startSlackConnections(h.deps, {
    reconcileMs: 60_000,
    log: { error: (...args: unknown[]) => void errors.push(args) },
    socket: { fetch: fake.fetch, initialBackoffMs: 20, maxBackoffMs: 100, invalidTokenRetryMs: 100, pingIntervalMs: 50, pongTimeoutMs: 200 },
    ...options,
  })
  return manager
}

function addBot(project: Project, { app = APP_TOKEN as string | null, bot = BOT_TOKEN as string | null, persona = 'verified' as BotPersonaStatus } = {}) {
  const id = randomUUID()
  const at = new Date().toISOString()
  h.database.db.insert(bots).values({
    id, projectId: project.id, name: `bot-${id.slice(0, 8)}`, family: 'claude-code', writeScope: 'read-only', baseBranch: 'main',
    personaName: 'ana', answersIn: { anywhere: true }, personaStatus: persona, createdAt: at, updatedAt: at,
  }).run()
  if (app) h.store.set(botSecretOwner(id), 'slackAppToken', app)
  if (bot) h.store.set(botSecretOwner(id), 'slackBotToken', bot)
  return id
}

describe('Slack Socket Mode connections', () => {
  it('opens exactly one connection when a bot becomes active and closes it when it stops being active', async () => {
    const project = await setup()
    const id = addBot(project, { persona: 'unverified' })
    const keyless = addBot(project, { app: null, bot: null })
    const slack = start({ reconcileMs: 20 })

    expect(slack.status(id)).toMatchObject({ state: 'disconnected', reasonCode: 'inactive', reason: expect.stringMatching(/Persona "ana" has not been checked/) })
    expect(slack.status(keyless)).toMatchObject({ state: 'disconnected', reasonCode: 'missing_keys', reason: 'Slack bot token and Slack app-level token are not set.' })
    expect(fake.links).toHaveLength(0)

    h.database.db.update(bots).set({ personaStatus: 'verified' }).where(eq(bots.id, id)).run()
    await until(() => slack.status(id).state === 'connected', 'connected')
    expect(slack.status(id)).toMatchObject({ reason: null, reasonCode: null, identity: { teamId: 'T0CANDY', team: 'Candy', userId: 'U0BOT', user: 'ana' } })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(fake.links).toHaveLength(1)

    h.store.delete(botSecretOwner(id), 'slackAppToken')
    await until(() => fake.open().length === 0, 'the link to close')
    expect(slack.status(id)).toMatchObject({ state: 'disconnected', reasonCode: 'missing_keys', reason: 'Slack app-level token is not set.' })

    h.store.set(botSecretOwner(id), 'slackAppToken', APP_TOKEN)
    await until(() => slack.status(id).state === 'connected', 'reconnected')
    h.database.db.update(projects).set({ archivedAt: new Date().toISOString() }).where(eq(projects.id, project.id)).run()
    await until(() => fake.open().length === 0, 'the archived link to close')
    expect(slack.status(id)).toMatchObject({ state: 'disconnected', reasonCode: 'archived' })
    expect(fake.links).toHaveLength(2)
  })

  it('acknowledges every envelope and emits typed events keyed by bot', async () => {
    const project = await setup()
    const id = addBot(project)
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
      kind: 'app_mention', botId: id, projectId: project.id, envelopeId: envelopes[0]!.envelope_id, retryAttempt: 1, retryReason: 'timeout', botUserId: 'U0BOT',
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
    const project = await setup()
    const id = addBot(project)
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
    const project = await setup()
    const badApp = addBot(project, { app: 'xapp-1-revoked' })
    const badBot = addBot(project, { bot: 'xoxb-revoked' })
    const slack = start()
    await until(() => slack.status(badApp).reasonCode === 'invalid_token' && slack.status(badBot).reasonCode === 'invalid_token', 'rejections')
    expect(slack.status(badApp)).toMatchObject({ state: 'disconnected', reason: 'Slack rejected the app-level token: invalid_auth (it is invalid or has been revoked).', retryAt: expect.any(String) })
    expect(slack.status(badBot).reason).toBe('Slack rejected the bot token: invalid_auth (it is invalid or has been revoked).')
    expect(fake.links).toHaveLength(0)

    h.store.set(botSecretOwner(badApp), 'slackAppToken', APP_TOKEN)
    slack.reconcile()
    await until(() => slack.status(badApp).state === 'connected', 'connected with the new token')
  })

  it('ends every connection on close', async () => {
    const project = await setup()
    const ids = [addBot(project), addBot(project)]
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
    const project = await setup()
    const id = addBot(project)
    const keyless = addBot(project, { bot: null })
    const slack = start()
    expect(slack.web(keyless)).toBeNull()
    const web = slack.web(id, { fetch: fake.fetch })!
    expect(await web.operations.authTest()).toMatchObject({ teamId: 'T0CANDY', userId: 'U0BOT' })
  })

  it('serves the connection state to admins only', async () => {
    const project = await setup()
    const id = addBot(project)
    const other = await h.createProject('beta')
    const foreign = addBot(other)
    const slack = start()
    await until(() => slack.status(id).state === 'connected', 'connected')
    const app = (roles: string[]) => createTestApp({
      db: h.database.db, paths: h.deps.paths, pluginTypes: h.deps.pluginTypes, secrets: h.store.writeOnly, secretsReader: h.store, runtime: { workspaceRoutes: [slackRoutes(slack)] },
      auth: { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) },
    })

    const res = await app(['admin']).request(botSlackConnectionPath('alpha', id))
    expect(res.status).toBe(200)
    expect((await res.json() as BotSlackConnectionResponse).connection).toMatchObject({ state: 'connected', identity: { user: 'ana' } })
    expect((await app(['admin']).request(botSlackConnectionPath('alpha', foreign))).status).toBe(404)
    expect((await app(['admin']).request(botSlackConnectionPath('gamma', id))).status).toBe(404)
    expect((await app(['member']).request(botSlackConnectionPath('alpha', id))).status).toBe(403)
    expect(await (await app(['admin']).request(botSlackConnectionPath('alpha', id))).text()).not.toMatch(/xapp-|xoxb-/)
  })
})
