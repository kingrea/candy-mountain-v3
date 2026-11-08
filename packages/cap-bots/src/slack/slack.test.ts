import { randomUUID } from 'node:crypto'
import type { Workspace } from '@candy-mountain/platform-sdk'
import { botSlackConnectionPath, type BotSlackConnectionResponse, type BotPersonaStatus } from '../wire'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { botSecretOwner } from '../bots'
import { bots } from '../schema'
import { createPluginInstance, testPluginInstance, workspaces } from '@candy-mountain/platform-daemon'
import { fixturePluginType, type InstanceHarness } from '@candy-mountain/platform-daemon/testing'
import { instanceHarness } from '../test-support'
import { startFakeSocketMode, startSlackConnections, type FakeSocketMode, type SlackConnections, type SlackConnectionsOptions } from '@candy-mountain/plugin-slack'
import { slackBotSource } from './bot-source'
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

async function setup(): Promise<Workspace> {
  h = instanceHarness([fixturePluginType('claude-code')])
  fake = await startFakeSocketMode()
  fake.validAppTokens.add(APP_TOKEN)
  fake.validBotTokens.add(BOT_TOKEN)
  const project = await h.createWorkspace('alpha')
  const instance = createPluginInstance(h.deps, { type: 'claude-code', scope: 'workspace', workspaceId: project.id, config: { account: 'jack' }, secrets: { token: 't' } })
  await testPluginInstance(h.deps, instance.id)
  return project
}

function start(options: SlackConnectionsOptions = {}) {
  manager = startSlackConnections({
    reconcileMs: 60_000,
    log: { error: (...args: unknown[]) => void errors.push(args) },
    socket: { fetch: fake.fetch, initialBackoffMs: 20, maxBackoffMs: 100, invalidTokenRetryMs: 100, pingIntervalMs: 50, pongTimeoutMs: 200 },
    ...options,
  })
  manager.attach(slackBotSource(h.deps))
  return manager
}

function addBot(project: Workspace, { app = APP_TOKEN as string | null, bot = BOT_TOKEN as string | null, persona = 'verified' as BotPersonaStatus } = {}) {
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

describe('the bots attached to the Slack connections', () => {
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
    h.database.db.update(workspaces).set({ archivedAt: new Date().toISOString() }).where(eq(workspaces.id, project.id)).run()
    await until(() => fake.open().length === 0, 'the archived link to close')
    expect(slack.status(id)).toMatchObject({ state: 'disconnected', reasonCode: 'archived' })
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
    const other = await h.createWorkspace('beta')
    const foreign = addBot(other)
    const slack = start()
    await until(() => slack.status(id).state === 'connected', 'connected')
    const app = (roles: string[]) => h.app(roles, { workspaceRoutes: [slackRoutes(slack)] })

    const res = await app(['admin']).request(botSlackConnectionPath('alpha', id))
    expect(res.status).toBe(200)
    expect((await res.json() as BotSlackConnectionResponse).connection).toMatchObject({ state: 'connected', identity: { user: 'ana' } })
    expect((await app(['admin']).request(botSlackConnectionPath('alpha', foreign))).status).toBe(404)
    expect((await app(['admin']).request(botSlackConnectionPath('gamma', id))).status).toBe(404)
    expect((await app(['member']).request(botSlackConnectionPath('alpha', id))).status).toBe(403)
    expect(await (await app(['admin']).request(botSlackConnectionPath('alpha', id))).text()).not.toMatch(/xapp-|xoxb-/)
  })
})
