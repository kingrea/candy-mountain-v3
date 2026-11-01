import { projectBotsPath, type Bot, type BotPersonaCheckResponse, type BotPersonaPreviewResponse, type BotResponse, type Project } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixturePluginType } from '../plugins/fixtures'
import { createPluginInstance, testPluginInstance } from '../plugins/instances/instances'
import { instanceHarness, type InstanceHarness } from '../plugins/instances/test-support'
import { GOOD_TOKEN, json, stubHosts } from '../plugins/repository/fake-hosts'
import { repositoryPluginType } from '../plugins/types/repository'
import { getBot } from './bots'
import { botsRoutes } from './definition'
import { BotError } from './errors'
import { assertBotPersonaBeforeSession, BotPersonaMissingError } from './persona'

const KEYS = { slackBotToken: 'xoxb-bot-1', slackAppToken: 'xapp-app-1' }

let h: InstanceHarness
/** The harness app with the bot routes, as the bots definition mounts them. */
const app = (roles?: string[]) => h.app(roles, botsRoutes({ db: h.database.db, secrets: h.store }))

afterEach(() => {
  h?.close()
  vi.unstubAllGlobals()
})

/** jack/candy (default `main`) holds `.claude/agents/ana.md` but no `.agents/ana.md`; paths in `deleted` answer 404. */
async function setup({ host = 'github', token = GOOD_TOKEN } = {}): Promise<{ project: Project, deleted: Set<string> }> {
  h = instanceHarness([repositoryPluginType, fixturePluginType('claude-code'), fixturePluginType('codex')])
  const deleted = new Set<string>()
  stubHosts(({ url }) => ([...deleted].some(path => decodeURIComponent(url.pathname).endsWith(`/${path}`)) ? json(404, { message: 'Not Found' }) : undefined))
  const project = await h.createProject('alpha')
  const add = (type: string, config: Record<string, unknown>, secrets: Record<string, string>) =>
    createPluginInstance(h.deps, { type, scope: 'project', projectId: project.id, config, secrets })
  add('repository', { host, owner: 'jack', repo: 'candy' }, { token })
  await testPluginInstance(h.deps, add('claude-code', { account: 'jack' }, { token: 't' }).id)
  await testPluginInstance(h.deps, add('codex', { account: 'jack' }, { token: 't' }).id)
  return { project, deleted }
}

function call(method: string, path: string, body?: unknown, roles?: string[]) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return app(roles).request(`${projectBotsPath('alpha')}${path}`, init)
}

async function created(body: unknown): Promise<Bot> {
  const res = await call('POST', '', body)
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json() as BotResponse).bot
}

async function checked(bot: Bot): Promise<BotPersonaCheckResponse> {
  const res = await call('POST', `/${bot.id}/check-persona`)
  expect(res.status, await res.clone().text()).toBe(200)
  return res.json() as Promise<BotPersonaCheckResponse>
}

async function errorOf(res: Response) {
  const { error } = await res.json() as { error: { code: string, message: string } }
  return { status: res.status, code: error.code, message: error.message }
}

describe('persona check', () => {
  it('reports Claude present and Codex missing, verifying a Claude Code bot', async () => {
    await setup()
    const bot = await created({ name: 'Ana', family: 'claude-code', personaName: 'ana', secrets: KEYS })
    const check = await checked(bot)

    expect(check).toMatchObject({ branch: 'main', claudeCode: true, codex: false, status: 'verified', reason: null, checkedAt: expect.any(String) })
    expect(check.bot.persona).toEqual({ name: 'ana', status: 'verified', checkedAt: check.checkedAt, reason: null })
    expect(check.bot.status).toBe('active')
  })

  it('gives a Codex bot a persona warning naming the missing file', async () => {
    await setup()
    const bot = await created({ name: 'Cody', family: 'codex', personaName: 'ana', secrets: KEYS })
    const check = await checked(bot)

    const reason = 'Codex persona file .agents/ana.md was not found on main'
    expect(check).toMatchObject({ claudeCode: true, codex: false, status: 'missing', reason })
    expect(check.bot.persona).toMatchObject({ status: 'missing', reason })
    expect(check.bot.status).toEqual({ warnings: [reason] })
    expect((await getBot(h.deps, bot.id)).status).toEqual({ warnings: [reason] })
  })

  it('fails a session start for the Codex bot naming .agents/<name>.md, and passes the Claude Code bot', async () => {
    await setup()
    const codex = await created({ name: 'Cody', family: 'codex', personaName: 'ana' })
    const claude = await created({ name: 'Ana', family: 'claude-code', personaName: 'ana' })

    const failure = await assertBotPersonaBeforeSession(h.deps, codex).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(BotPersonaMissingError)
    expect(failure).toMatchObject({ code: 'persona_missing', path: '.agents/ana.md', branch: 'main', family: 'codex' })
    expect((failure as Error).message).toBe('Bot "Cody" cannot start: Codex persona file .agents/ana.md was not found on main')

    expect(await assertBotPersonaBeforeSession(h.deps, claude)).toMatchObject({ status: 'verified', bot: { persona: { status: 'verified' } } })
  })

  it('catches a persona removed after it was verified', async () => {
    const { deleted } = await setup()
    const bot = await created({ name: 'Ana', family: 'claude-code', personaName: 'ana', secrets: KEYS })
    expect((await checked(bot)).bot.status).toBe('active')

    deleted.add('.claude/agents/ana.md')
    await expect(assertBotPersonaBeforeSession(h.deps, await getBot(h.deps, bot.id))).rejects.toThrow(/\.claude\/agents\/ana\.md was not found on main/)
    expect((await getBot(h.deps, bot.id)).status).toEqual({ warnings: ['Claude Code persona file .claude/agents/ana.md was not found on main'] })
  })

  it('records a missing base branch as a missing persona', async () => {
    await setup({ host: 'bitbucket' })
    const bot = await created({ name: 'Ana', family: 'claude-code', personaName: 'ana', baseBranch: 'develop' })
    const check = await checked(bot)
    expect(check).toMatchObject({ branch: 'develop', claudeCode: false, codex: false, status: 'missing' })
    expect(check.reason).toBe('Claude Code persona file .claude/agents/ana.md could not be looked up: Branch \'develop\' does not exist in jack/candy.')
  })

  it('records nothing when the host fails', async () => {
    await setup({ token: 'wrong-token' })
    const bot = await created({ name: 'Ana', family: 'claude-code', personaName: 'ana' })
    expect(await errorOf(await call('POST', `/${bot.id}/check-persona`))).toMatchObject({ status: 502, code: 'persona_check_failed', message: expect.stringMatching(/GitHub returned 401/) })
    expect((await getBot(h.deps, bot.id)).persona).toMatchObject({ status: 'unverified', checkedAt: null })
  })

  it('refuses a bot without a persona name, at the route and at session start', async () => {
    await setup()
    const bot = await created({ name: 'Ana', family: 'claude-code' })
    expect(await errorOf(await call('POST', `/${bot.id}/check-persona`))).toMatchObject({ status: 422, code: 'persona_not_set' })
    await expect(assertBotPersonaBeforeSession(h.deps, bot)).rejects.toSatisfy(error => error instanceof BotError && error.code === 'persona_not_set')
  })

  it('previews an unsaved persona on a project without recording anything', async () => {
    await setup({ host: 'bitbucket' })
    const res = await call('POST', '/check-persona', { personaName: 'ana', baseBranch: ' ' })
    expect(res.status).toBe(200)
    expect(await res.json() as BotPersonaPreviewResponse).toEqual({ branch: 'main', claudeCode: true, codex: false })

    expect(await errorOf(await call('POST', '/check-persona', { personaName: '../x' }))).toMatchObject({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await call('POST', '/check-persona', { personaName: 'ana', family: 'codex' }))).toMatchObject({ status: 400, code: 'invalid_request' })
  })

  it('is admin only and scoped to the project', async () => {
    await setup()
    const bot = await created({ name: 'Ana', family: 'claude-code', personaName: 'ana' })
    await h.createProject('beta')
    expect((await app().request(`${projectBotsPath('beta')}/${bot.id}/check-persona`, { method: 'POST' })).status).toBe(404)
    expect(await errorOf(await call('POST', `/${bot.id}/check-persona`, undefined, ['member']))).toMatchObject({ status: 403, code: 'forbidden' })
    expect(await errorOf(await call('POST', '/check-persona', { personaName: 'ana' }, ['member']))).toMatchObject({ status: 403, code: 'forbidden' })
  })
})
