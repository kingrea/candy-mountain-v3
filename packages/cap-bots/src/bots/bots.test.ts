import { randomUUID } from 'node:crypto'
import type { PluginHealth, Workspace } from '@crab-shack/platform-sdk'
import { eq, inArray } from 'drizzle-orm'
import { workspaceBotsPath, type Bot, type BotListResponse, type BotResponse } from '../wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentSessions, createPluginInstance, platformMeta, resolvePluginInstance, testPluginInstance, updatePluginInstance } from '@crab-shack/platform-daemon'
import { fixturePluginType, type InstanceHarness } from '@crab-shack/platform-daemon/testing'
import { botsKit, instanceHarness, restartBots } from '../test-support'
import { GOOD_TOKEN, stubHosts } from '../test-support'
import { repositoryPluginType } from '@candy-mountain/plugin-repository'
import { botSecretOwner, getBot, listBots, recordBotPersonaCheck } from './bots'
import { botsRoutes } from '../definition'
import { slackDeliveries } from '../schema'
import { claimSlackDelivery, insertSlackThread } from '../slack/threads'
import { openSlackTurn } from '../slack/turns'
import { slackDecisionMetaKey, slackHandoffMetaKey } from '../slack/meta'

const BOT_TOKEN = 'xoxb-bot-secret-111'
const APP_TOKEN = 'xapp-app-secret-222'

let h: InstanceHarness
afterEach(() => {
  h?.close()
  vi.unstubAllGlobals()
})

const unhealthy: PluginHealth = { healthy: false, reason: 'Not logged in.' }

/** The harness app with the bot routes and the deletion hook, as the bots definition mounts them. */
const app = (roles?: string[]) => h.app(roles, botsRoutes({ db: h.database.db, secrets: h.store }))

interface SetupOptions {
  repository?: boolean
  repositoryToken?: string
  claude?: 'healthy' | 'untested' | 'none'
}

/** Workspace `alpha` with a GitHub repository (jack/candy, default `main`), a healthy Claude Code plugin and an unhealthy Codex one. */
async function setup({ repository = true, repositoryToken = GOOD_TOKEN, claude = 'healthy' }: SetupOptions = {}): Promise<Workspace> {
  h = instanceHarness([repositoryPluginType, fixturePluginType('claude-code'), fixturePluginType('codex', () => unhealthy)])
  const hosts = stubHosts()
  const project = await h.createWorkspace('alpha')
  const add = (type: string, config: Record<string, unknown>, secrets: Record<string, string>) =>
    createPluginInstance(h.deps, { type, scope: 'workspace', workspaceId: project.id, config, secrets })
  if (repository) add('repository', { host: 'github', owner: 'jack', repo: 'candy' }, { token: repositoryToken })
  if (claude !== 'none') {
    const instance = add('claude-code', { account: 'jack' }, { token: 't' })
    if (claude === 'healthy') await testPluginInstance(h.deps, instance.id)
  }
  await testPluginInstance(h.deps, add('codex', { account: 'jack' }, { token: 't' }).id)
  hosts.requests.length = 0
  return project
}

function call(method: string, path: string, body?: unknown, roles?: string[]) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return app(roles).request(`${workspaceBotsPath('alpha')}${path}`, init)
}

async function created(body: unknown): Promise<Bot> {
  const res = await call('POST', '', body)
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json() as BotResponse).bot
}

async function errorOf(res: Response) {
  return { status: res.status, code: (await res.json() as { error: { code: string } }).error.code }
}

describe('bot routes', () => {
  it('creates a bot with a missing Slack key, naming it in the warnings, and never returns a secret', async () => {
    await setup()
    const bodies: string[] = []
    const bot = await created({ name: 'Ana', family: 'claude-code', writeScope: 'write-confirm', personaName: 'ana', secrets: { slackBotToken: BOT_TOKEN } })
    bodies.push(JSON.stringify(bot))

    expect(bot).toMatchObject({
      name: 'Ana',
      family: 'claude-code',
      writeScope: 'write-confirm',
      baseBranch: null,
      effectiveBaseBranch: 'main',
      persona: { name: 'ana', status: 'unverified', checkedAt: null, reason: null },
      answersIn: { anywhere: true },
      secrets: { slackBotToken: 'set', slackAppToken: 'unset' },
      status: { warnings: ['Persona "ana" has not been checked', 'Slack app-level token is missing'] },
    })
    expect(h.store.get(botSecretOwner(bot.id), 'slackBotToken')).toBe(BOT_TOKEN)

    for (const res of [await call('GET', ''), await call('GET', `/${bot.id}`), await call('PATCH', `/${bot.id}`, { secrets: { slackAppToken: APP_TOKEN } })]) {
      expect(res.status).toBe(200)
      bodies.push(await res.text())
    }
    for (const body of bodies) expect(body).not.toMatch(/secret-/)
  })

  it('rejects a family whose plugin is unhealthy, untested or missing', async () => {
    await setup({ claude: 'untested' })
    expect(await errorOf(await call('POST', '', { name: 'Bob', family: 'codex' }))).toEqual({ status: 422, code: 'family_unavailable' })
    const untested = await call('POST', '', { name: 'Bob', family: 'claude-code' })
    expect(await untested.clone().json()).toMatchObject({ error: { message: expect.stringMatching(/has not been tested/) } })
    expect(await errorOf(untested)).toEqual({ status: 422, code: 'family_unavailable' })
  })

  it('rejects a family with no plugin and a project without a configured Repository plugin', async () => {
    const project = await setup({ repository: false, claude: 'none' })
    expect(await errorOf(await call('POST', '', { name: 'Bob', family: 'claude-code' }))).toEqual({ status: 422, code: 'repository_not_configured' })
    createPluginInstance(h.deps, { type: 'repository', scope: 'workspace', workspaceId: project.id, config: { host: 'github', owner: 'jack', repo: 'candy' }, secrets: { token: GOOD_TOKEN } })
    expect(await errorOf(await call('POST', '', { name: 'Bob', family: 'claude-code' }))).toEqual({ status: 422, code: 'family_unavailable' })
  })

  it('resolves a blank base branch from the repository at read time and keeps an explicit one', async () => {
    const project = await setup()
    const blank = await created({ name: 'Blank', family: 'claude-code', baseBranch: '  ' })
    const fixed = await created({ name: 'Fixed', family: 'claude-code', baseBranch: 'develop' })
    expect(blank).toMatchObject({ baseBranch: null, effectiveBaseBranch: 'main' })
    expect(fixed).toMatchObject({ baseBranch: 'develop', effectiveBaseBranch: 'develop' })

    const repository = resolvePluginInstance(h.deps, project.id, 'repository')!
    updatePluginInstance(h.deps, repository.id, { config: { defaultBranch: 'trunk' } })
    const listed = (await (await call('GET', '')).json() as BotListResponse).bots
    expect(listed.map(b => [b.name, b.baseBranch, b.effectiveBaseBranch])).toEqual([['Blank', null, 'trunk'], ['Fixed', 'develop', 'develop']])

    const patched = (await (await call('PATCH', `/${fixed.id}`, { baseBranch: null })).json() as BotResponse).bot
    expect(patched).toMatchObject({ baseBranch: null, effectiveBaseBranch: 'trunk' })
  })

  it('reports a warning instead of failing when the default branch cannot be read', async () => {
    await setup({ repositoryToken: 'wrong-token' })
    const bot = await created({ name: 'Ana', family: 'claude-code', personaName: 'ana', secrets: { slackBotToken: BOT_TOKEN, slackAppToken: APP_TOKEN } })
    expect(bot.effectiveBaseBranch).toBeNull()
    expect(bot.status).toEqual({ warnings: ['Persona "ana" has not been checked', expect.stringMatching(/^The base branch is blank and the repository's default branch could not be read: GitHub returned 401/)] })
  })

  it('is active once the persona is verified and both keys are set, and a persona change resets the check', async () => {
    await setup()
    const bot = await created({ name: 'Ana', family: 'claude-code', personaName: 'ana', secrets: { slackBotToken: BOT_TOKEN, slackAppToken: APP_TOKEN } })
    expect(recordBotPersonaCheck(h.database.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(true)
    const active = await getBot(h.deps, bot.id)
    expect(active.status).toBe('active')
    expect(active.persona).toMatchObject({ status: 'verified', checkedAt: expect.any(String) })

    const renamed = (await (await call('PATCH', `/${bot.id}`, { personaName: 'bea' })).json() as BotResponse).bot
    expect(renamed.persona).toEqual({ name: 'bea', status: 'unverified', checkedAt: null, reason: null })
    expect(recordBotPersonaCheck(h.database.db, bot.id, bot.updatedAt, { status: 'verified' })).toBe(false)

    expect(recordBotPersonaCheck(h.database.db, bot.id, renamed.updatedAt, { status: 'missing', reason: '.claude/agents/bea.md is not on main' })).toBe(true)
    expect((await getBot(h.deps, bot.id)).status).toEqual({ warnings: ['.claude/agents/bea.md is not on main'] })

    const scoped = (await (await call('PATCH', `/${bot.id}`, { writeScope: 'write-auto', answersIn: { channels: ['C0123ABCD', 'C0123ABCD', 'G0456'] } })).json() as BotResponse).bot
    expect(scoped).toMatchObject({ writeScope: 'write-auto', answersIn: { channels: ['C0123ABCD', 'G0456'] }, persona: { status: 'missing' } })
  })

  it('is not configured with no Slack keys and an unchecked persona', async () => {
    await setup()
    expect((await created({ name: 'Ana', family: 'claude-code', personaName: 'ana' })).status).toBe('not_configured')
  })

  it('updates secrets like plugin instances: a string sets, empty or omitted leaves, null clears', async () => {
    await setup()
    const bot = await created({ name: 'Ana', family: 'claude-code', secrets: { slackBotToken: BOT_TOKEN, slackAppToken: APP_TOKEN } })
    const owner = botSecretOwner(bot.id)
    const patch = async (body: unknown) => (await (await call('PATCH', `/${bot.id}`, body)).json() as BotResponse).bot

    expect((await patch({ secrets: { slackBotToken: '' } })).secrets).toEqual({ slackBotToken: 'set', slackAppToken: 'set' })
    expect((await patch({ name: 'Ana 2' })).secrets).toEqual({ slackBotToken: 'set', slackAppToken: 'set' })
    expect((await patch({ secrets: { slackAppToken: null } })).secrets).toEqual({ slackBotToken: 'set', slackAppToken: 'unset' })
    await patch({ secrets: { slackBotToken: 'xoxb-new-secret' } })
    expect(h.store.get(owner, 'slackBotToken')).toBe('xoxb-new-secret')
  })

  it('lets a bot be edited while its family plugin is unhealthy but not switched to an unhealthy family', async () => {
    const project = await setup()
    const bot = await created({ name: 'Ana', family: 'claude-code' })
    const claude = resolvePluginInstance(h.deps, project.id, 'claude-code')!
    updatePluginInstance(h.deps, claude.id, { config: { account: 'someone-else' } })

    const res = await call('PATCH', `/${bot.id}`, { name: 'Renamed' })
    expect(res.status).toBe(200)
    expect((await res.json() as BotResponse).bot.status).toBe('not_configured')
    expect(await errorOf(await call('PATCH', `/${bot.id}`, { family: 'codex' }))).toEqual({ status: 422, code: 'family_unavailable' })
  })

  it('returns error bodies for bad requests', async () => {
    await setup()
    await created({ name: 'Ana', family: 'claude-code' })
    const good = { name: 'Bob', family: 'claude-code' }
    const cases: [unknown, number, string][] = [
      ['{', 400, 'invalid_request'],
      [{ ...good, name: ' ' }, 400, 'invalid_request'],
      [{ ...good, family: 'gemini' }, 400, 'invalid_request'],
      [{ ...good, writeScope: 'write' }, 400, 'invalid_request'],
      [{ ...good, baseBranch: 'bad branch' }, 400, 'invalid_request'],
      [{ ...good, personaName: '../etc' }, 400, 'invalid_request'],
      [{ ...good, answersIn: { channels: [] } }, 400, 'invalid_request'],
      [{ ...good, answersIn: { channels: ['general'] } }, 400, 'invalid_request'],
      [{ ...good, answersIn: { anywhere: false } }, 400, 'invalid_request'],
      [{ ...good, keyword: 'hey' }, 400, 'invalid_request'],
      [{ ...good, secrets: { slackBotToken: 3 } }, 400, 'invalid_request'],
      [{ ...good, secrets: { teamId: 'T1' } }, 422, 'invalid_secrets'],
      [{ ...good, secrets: { slackBotToken: APP_TOKEN } }, 422, 'invalid_secrets'],
      [{ ...good, name: 'ana' }, 409, 'name_taken'],
    ]
    for (const [body, status, code] of cases) {
      expect(await errorOf(await call('POST', '', body)), JSON.stringify(body)).toEqual({ status, code })
    }
    expect((await (await call('GET', '')).json() as BotListResponse).bots.map(b => b.name)).toEqual(['Ana'])
    expect(await errorOf(await call('GET', '/nope'))).toEqual({ status: 404, code: 'not_found' })
    expect(await errorOf(await app().request('/workspaces/ghost/bots'))).toEqual({ status: 404, code: 'not_found' })
  })

  it('refuses Slack keys while the secrets store is locked', async () => {
    stubHosts()
    let kit = botsKit()
    try {
      const workspace = kit.workspace({ name: 'alpha', slug: 'alpha' })
      kit.pluginInstance({ type: 'repository', workspace, config: { host: 'github', owner: 'jack', repo: 'candy' }, secrets: { token: GOOD_TOKEN } })
      kit.pluginInstance({ type: 'claude-code', workspace })
      const request = (method: string, path: string, body: unknown) =>
        kit.admin.request(`${workspaceBotsPath('alpha')}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const first = await request('POST', '', { name: 'Ana', family: 'claude-code', secrets: { slackBotToken: BOT_TOKEN } })
      expect(first.status, await first.clone().text()).toBe(201)
      const bot = (await first.json() as BotResponse).bot
      kit = await restartBots(kit, { lockedSecrets: true })
      const { deps } = kit

      expect(await errorOf(await request('POST', '', { name: 'Bob', family: 'claude-code', secrets: { slackAppToken: APP_TOKEN } }))).toEqual({ status: 409, code: 'secrets_locked' })
      expect(await errorOf(await request('PATCH', `/${bot.id}`, { name: 'Renamed', secrets: { slackAppToken: APP_TOKEN } }))).toEqual({ status: 409, code: 'secrets_locked' })
      const named = await request('POST', '', { name: 'Bob', family: 'claude-code' })
      expect(named.status).toBe(201)
      expect((await getBot(deps, bot.id)).name).toBe('Ana')
      expect((await listBots(deps)).map(b => b.name)).toEqual(['Ana', 'Bob'])
    }
    finally {
      await kit.close()
    }
  })

  it('deletes a bot with its secrets, and a project delete removes its bots\' secrets', async () => {
    await setup()
    const one = await created({ name: 'One', family: 'claude-code', secrets: { slackBotToken: BOT_TOKEN } })
    const two = await created({ name: 'Two', family: 'claude-code', secrets: { slackAppToken: APP_TOKEN } })

    expect((await call('DELETE', `/${one.id}`)).status).toBe(204)
    expect(h.store.isSet(botSecretOwner(one.id), 'slackBotToken')).toBe(false)
    expect((await call('GET', `/${one.id}`)).status).toBe(404)
    expect((await call('DELETE', `/${one.id}`)).status).toBe(404)

    expect((await app().request('/workspaces/alpha', { method: 'DELETE' })).status).toBe(204)
    expect(h.store.isSet(botSecretOwner(two.id), 'slackAppToken')).toBe(false)
    expect(await listBots(h.deps)).toEqual([])
  })

  it('deletes a bot\'s Slack deliveries and its decision and handoff keys, keeping another bot\'s', async () => {
    const project = await setup()
    const db = h.database.db
    const at = new Date().toISOString()
    const seed = (botId: string) => {
      const sessionId = randomUUID()
      db.insert(agentSessions).values({ id: sessionId, workspaceId: project.id, family: 'claude-code', actorId: 'u1', cwd: '/tmp', createdAt: at, lastActivityAt: at }).run()
      const thread = insertSlackThread(db, { botId, projectId: project.id, teamId: null, channelId: 'C1', threadTs: `${botId}.1`, sessionId, slackMemberId: 'U1', at })
      const turn = openSlackTurn(db, { threadId: thread.id, sessionId, slackMemberId: 'U1', promptSeq: 1, at })
      claimSlackDelivery(db, { botId, eventId: 'E1', channelId: 'C1', ts: '1.1' }, at)
      db.insert(platformMeta).values([
        { key: slackHandoffMetaKey(turn.id), value: '1', updatedAt: at },
        { key: slackDecisionMetaKey(`decision-of-${botId}`), value: JSON.stringify({ botId, channel: 'C1', ts: '1.2' }), updatedAt: at },
      ]).run()
      return [slackHandoffMetaKey(turn.id), slackDecisionMetaKey(`decision-of-${botId}`)]
    }
    const one = await created({ name: 'One', family: 'claude-code' })
    const two = await created({ name: 'Two', family: 'claude-code' })
    const keysOf = { [one.id]: seed(one.id), [two.id]: seed(two.id) }
    const left = (botId: string) => ({
      deliveries: db.select().from(slackDeliveries).where(eq(slackDeliveries.botId, botId)).all().length,
      keys: db.select().from(platformMeta).where(inArray(platformMeta.key, keysOf[botId]!)).all().length,
    })

    expect((await call('DELETE', `/${one.id}`)).status).toBe(204)
    expect(left(one.id)).toEqual({ deliveries: 0, keys: 0 })
    expect(left(two.id)).toEqual({ deliveries: 1, keys: 2 })

    expect((await app().request('/workspaces/alpha', { method: 'DELETE' })).status).toBe(204)
    expect(left(two.id)).toEqual({ deliveries: 0, keys: 0 })
  })

  it('hides bots from other projects and from non-admins', async () => {
    await setup()
    const bot = await created({ name: 'Ana', family: 'claude-code' })
    await h.createWorkspace('beta')
    expect((await app().request(`${workspaceBotsPath('beta')}/${bot.id}`)).status).toBe(404)
    expect((await app().request(`${workspaceBotsPath('beta')}/${bot.id}`, { method: 'DELETE' })).status).toBe(404)
    expect(await errorOf(await call('GET', '', undefined, ['member']))).toEqual({ status: 403, code: 'forbidden' })
    expect(await errorOf(await call('POST', '', { name: 'X', family: 'claude-code' }, ['member']))).toEqual({ status: 403, code: 'forbidden' })
  })
})
