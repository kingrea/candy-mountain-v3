import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BOTS_CAPABILITY_ID, PLATFORM_AGENT_ID, PLATFORM_SETTINGS_PATH, projectRegistryPath, projectThreadsPath, threadPromptPath, type Actor, type AgentSessionEvent, type ApiErrorBody, type ChatThreadResponse, type Project, type RegistryResponse } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { assertCapability, CapabilityManifestError } from '../capabilities'
import { platformAgentCapability } from '../capabilities/manifests/platform-agent'
import { pluginInstances } from '../db/schema'
import { resolveActorRungs } from '../grants/resolve'
import { createMastra, type PlatformMastra } from '../mastra'
import { createPluginInstance } from '../plugins/instances/instances'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject } from '../projects/projects'
import { startPlatform, type Platform } from '../platform'
import { resolveCapabilityAccess } from '../registry'
import { MasterKey } from '../secrets'
import { createTempDataDir, type TempDataDir } from '../testing'
import type { NativeFamilyRunners } from '../threads'
import { createPlatformAgent } from './agent'
import type { PlatformTurnContext } from './context'
import { createPlatformAgentRunner } from './runner'
import { scriptedReply, startStubGateway, type StubGateway } from './test-support'
import { describePlatform, openView, startChat } from './tools'

const ADMIN: Actor = { id: 'admin-actor', username: 'admin', displayName: 'Admin', roles: ['admin'] }
const DEVELOPER: Actor = { id: 'dev-actor', username: 'dev', displayName: 'Dev', roles: ['developer'] }

let temp: TempDataDir | undefined
let platform: Platform | undefined
let mastra: PlatformMastra | undefined
let gateway: StubGateway | undefined
let native: NativeFamilyRunners = {}

afterEach(async () => {
  await gateway?.close()
  await platform?.sessions.close()
  await mastra?.close()
  platform?.close()
  temp?.cleanup()
  gateway = platform = mastra = temp = undefined
  native = {}
})

async function boot(): Promise<Platform> {
  temp = createTempDataDir()
  platform = startPlatform(temp.root, { secretsKey: MasterKey.generate() })
  mastra = await createMastra(platform.paths, { agents: storage => ({ [PLATFORM_AGENT_ID]: createPlatformAgent({ storage }) }) })
  const p = platform
  native = { platform: createPlatformAgentRunner({ db: p.db, capabilities: p.capabilities, modules: p.modules, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets, mastra: mastra.mastra }) }
  return platform
}

const as = (actor: Actor): AuthStrategy => ({ name: 'development', resolve: () => actor })

function call(method: string, path: string, body?: unknown, actor: Actor = ADMIN) {
  const p = platform!
  const app = createApp({ db: p.db, paths: p.paths, auth: as(actor), capabilities: p.capabilities, modules: p.modules, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets, sessions: p.sessions, nativeFamilies: native })
  const init: RequestInit = { method }
  if (body !== undefined) init.headers = { 'content-type': 'application/json' }
  if (body !== undefined) init.body = JSON.stringify(body)
  return app.request(path, init)
}

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status)
  return res.json() as Promise<T>
}

async function project(slug = 'alpha', modules = ['issues', 'agent-hub']): Promise<Project> {
  const path = join(temp!.root, '..', 'repos', slug)
  mkdirSync(path, { recursive: true })
  const created = await createProject(platform!.db, { name: 'Alpha', slug, source: { kind: 'local-path', path } })
  setEnabledModules(platform!.db, created.id, modules as never)
  return created
}

async function configureGateway(): Promise<void> {
  gateway ??= await startStubGateway(scriptedReply)
  await json(await call('PUT', PLATFORM_SETTINGS_PATH, { gatewayBaseUrl: gateway.url, gatewayKey: 'sk-stub-key', modelId: 'stub-model' }), 200)
}

const registry = async (actor: Actor = ADMIN) => json<RegistryResponse>(await call('GET', projectRegistryPath('alpha'), undefined, actor), 200)

function healthyClaude(projectId: string): void {
  const p = platform!
  const instance = createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type: 'claude-code', scope: 'project', projectId, config: {}, secrets: {} })
  p.db.update(pluginInstances).set({ health: { healthy: true }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, instance.id)).run()
}

/** Prompts a fresh platform thread and returns its session log once the turn has ended. */
async function converse(text: string, actor: Actor = ADMIN): Promise<{ thread: ChatThreadResponse, events: AgentSessionEvent[] }> {
  const thread = await json<ChatThreadResponse>(await call('POST', projectThreadsPath('alpha'), { agentId: PLATFORM_AGENT_ID }, actor), 201)
  const ended = new Promise<void>((resolve) => {
    const unsubscribe = platform!.sessions.subscribe(thread.session.id, (message) => {
      if (message.type === 'event' && message.event.kind === 'turn_end') {
        unsubscribe()
        resolve()
      }
    })
  })
  const prompted = await json<ChatThreadResponse>(await call('POST', threadPromptPath('alpha', thread.thread.id), { text }, actor), 202)
  expect(prompted.thread.working).toBe(true)
  await ended
  return { thread, events: platform!.sessions.events(thread.session.id) }
}

const textOf = (events: AgentSessionEvent[]) => events.filter(e => e.kind === 'text').map(e => (e as { text: string }).text).join('')
/** Streamed text lands in as many rows as the flush timer cut it into, so runs of text count once. */
const kindsOf = (events: AgentSessionEvent[]) => events.map(e => e.kind).filter((kind, i, all) => kind !== 'text' || all[i - 1] !== 'text')

describe('platform agent in the registry', () => {
  it('is absent until the gateway base URL, key and model are all set, then appears for every role', async () => {
    await boot()
    await project()
    expect((await registry()).agents.map(a => a.id)).toEqual([])
    const before = (await registry()).capabilities.find(cap => cap.id === 'platform-agent')
    expect(before).toMatchObject({ rung: 'chat', chat: true, ready: false, modules: [], tools: ['open_view', 'start_chat', 'describe_platform'] })
    expect(before!.reasons).toEqual([{ kind: 'platform-fact', fact: 'llmGateway', message: expect.stringContaining('Settings page') }])
    expect((await registry(DEVELOPER)).capabilities.find(cap => cap.id === 'platform-agent')).toMatchObject({ rung: 'chat', ready: false, reasons: [] })

    gateway = await startStubGateway(scriptedReply)
    await json(await call('PUT', PLATFORM_SETTINGS_PATH, { gatewayKey: 'sk-stub-key', modelId: 'stub-model' }), 200)
    expect((await registry()).agents).toEqual([])
    await json(await call('PUT', PLATFORM_SETTINGS_PATH, { gatewayBaseUrl: gateway.url }), 200)

    const agent = { id: 'platform', capabilityId: 'platform-agent', label: 'Platform', description: expect.any(String), family: 'platform', avatar: 'i-lucide-mountain' }
    expect((await registry()).agents).toEqual([agent])
    expect((await registry(DEVELOPER)).agents).toEqual([agent])
    expect((await registry()).groups.map(group => group.id)).not.toContain('platform-agent')

    await json(await call('PUT', PLATFORM_SETTINGS_PATH, { gatewayKey: null }), 200)
    expect((await registry()).agents).toEqual([])
    const refused = await call('POST', projectThreadsPath('alpha'), { agentId: PLATFORM_AGENT_ID })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as ApiErrorBody).error.code).toBe('not_ready')
  })

  it('holds the chat rung for a role with no grants at all, and refuses an everyoneRung that is not on the ladder', async () => {
    const p = await boot()
    const rungs = resolveActorRungs(p, { roles: ['nobody'] })
    expect(rungs['platform-agent']).toBe('chat')
    expect(rungs.overview).toBe('read')
    expect(rungs.issues).toBe('none')

    const bad = () => assertCapability({ ...platformAgentCapability, everyoneRung: 'manage' })
    expect(bad).toThrow(CapabilityManifestError)
    expect(bad).toThrow(/everyoneRung 'manage' is not on the ladder/)
    expect(() => assertCapability({ ...platformAgentCapability, everyoneRung: 'none' })).toThrow(/grants nothing/)
  })
})

describe('platform agent tools', () => {
  function turnFor(actor: Actor, project: Project): PlatformTurnContext {
    const p = platform!
    const registry = { project: { id: project.id, slug: project.slug, name: project.name }, admin: actor.roles.includes('admin'), modules: [], groups: [], views: [], agents: [], capabilities: [], degraded: [] }
    return { actor, project, capabilities: p.capabilities, registry, access: id => resolveCapabilityAccess(p, actor, project, id), model: { baseUrl: 'http://stub', modelId: 'm', apiKey: 'k' } }
  }

  it('returns typed actions for the admin and refusals as values for everyone else', async () => {
    await boot()
    const alpha = await project()
    healthyClaude(alpha.id)
    await configureGateway()

    expect(openView(turnFor(ADMIN, alpha), 'overview')).toEqual({ refused: false, action: { kind: 'navigate', to: '/p/alpha', projectSlug: 'alpha', viewId: 'overview', capabilityId: 'overview' }, summary: expect.stringContaining('Overview') })
    expect(openView(turnFor(ADMIN, alpha), 'nope')).toMatchObject({ refused: true, code: 'not_found' })
    expect(openView(turnFor(DEVELOPER, alpha), 'overview')).toMatchObject({ refused: false, action: { kind: 'navigate', to: '/p/alpha' } })
    expect(openView(turnFor(DEVELOPER, alpha), 'issues')).toEqual({ refused: true, code: 'not_granted', reason: expect.stringContaining("Rung 'none' of 'issues'") })

    expect(startChat(turnFor(ADMIN, alpha), 'claude-code')).toEqual({ refused: false, action: { kind: 'open_thread', agentId: 'claude-code' }, summary: expect.stringContaining('Claude Code') })
    expect(startChat(turnFor(ADMIN, alpha), 'codex')).toMatchObject({ refused: true, code: 'not_ready' })
    expect(startChat(turnFor(DEVELOPER, alpha), 'claude-code')).toMatchObject({ refused: true, code: 'not_granted' })
    expect(startChat(turnFor(ADMIN, alpha), PLATFORM_AGENT_ID)).toMatchObject({ refused: true, code: 'invalid_request' })
    expect(startChat(turnFor(ADMIN, alpha), 'ghost')).toMatchObject({ refused: true, code: 'not_found' })

    expect(describePlatform(turnFor(DEVELOPER, alpha))).toMatchObject({ refused: false, project: { slug: 'alpha', name: 'Alpha' }, actor: { displayName: 'Dev', admin: false } })
  })
})

describe('start_chat with bots', () => {
  const bot = (id: string, label: string) => ({ id: `bot:${id}`, capabilityId: 'bots', label, description: 'Claude Code bot', family: 'claude-code', kind: 'bot', bot: { id, writeScope: 'branch', baseBranch: null } })

  async function botTurn(actor: Actor, agents: unknown[], botsUsable = true): Promise<PlatformTurnContext> {
    await boot()
    const alpha = await project()
    healthyClaude(alpha.id)
    await configureGateway()
    const p = platform!
    const registry = { project: { id: alpha.id, slug: 'alpha', name: 'Alpha' }, admin: actor.roles.includes('admin'), modules: [], groups: [], views: [], agents, capabilities: [], degraded: [] } as unknown as RegistryResponse
    const usable = (id: string) => ({ ...resolveCapabilityAccess(p, actor, alpha, id), enabled: true, reasons: [], rung: { name: 'chat', chat: true } as never })
    return { actor, project: alpha, capabilities: p.capabilities, registry, access: id => (botsUsable && id === BOTS_CAPABILITY_ID ? usable(id) : resolveCapabilityAccess(p, actor, alpha, id)), model: { baseUrl: 'http://stub', modelId: 'm', apiKey: 'k' } }
  }

  it('opens a bot thread by agent id or case-insensitive name, with the id unchanged', async () => {
    const turn = await botTurn(ADMIN, [bot('b1', 'Ana Bot')])
    const opened = { refused: false, action: { kind: 'open_thread', agentId: 'bot:b1' }, summary: expect.stringContaining('Ana Bot') }
    expect(startChat(turn, 'bot:b1')).toEqual(opened)
    expect(startChat(turn, 'ana bot')).toEqual(opened)
  })

  it('refuses an unknown, unusable or ambiguous bot', async () => {
    const turn = await botTurn(ADMIN, [bot('b1', 'Ana'), bot('b2', 'ana')])
    expect(startChat(turn, 'bot:ghost')).toEqual({ refused: true, code: 'not_found', reason: "No chat agent with id 'bot:ghost'" })
    expect(startChat(turn, 'Ghost')).toMatchObject({ refused: true, code: 'not_found' })
    expect(startChat(turn, 'ANA')).toMatchObject({ refused: true, code: 'invalid_request', reason: expect.stringContaining('bot:b1, bot:b2') })
    expect(startChat(turn, 'bot:b2')).toMatchObject({ refused: false })
  })

  it('relays the bots capability refusal when bots are not usable at all', async () => {
    const turn = await botTurn(ADMIN, [], false)
    expect(startChat(turn, 'bot:b1')).toMatchObject({ refused: true, code: 'not_ready', reason: expect.stringContaining("Capability 'bots' is not ready") })
  })
})

describe('platform agent threads', () => {
  it('describes the platform from the registry through the configured gateway', async () => {
    await boot()
    const alpha = await project()
    healthyClaude(alpha.id)
    await configureGateway()

    const { thread, events } = await converse('Describe the platform for me')
    expect(gateway!.requests[0]).toMatchObject({ model: 'stub-model', authorization: 'Bearer sk-stub-key', tools: ['open_view', 'start_chat', 'describe_platform'] })
    expect(gateway!.requests[0]!.messages[0]!.content).toContain('project "Alpha"')
    expect(kindsOf(events)).toEqual(['prompt', 'tool_call', 'tool_result', 'text', 'turn_end'])
    expect(events[1]).toMatchObject({ kind: 'tool_call', toolCall: { title: 'Describe platform', status: 'in_progress', rawInput: {} } })
    expect(events[2]).toMatchObject({ kind: 'tool_result', update: { status: 'completed', rawOutput: { refused: false, views: expect.arrayContaining([expect.objectContaining({ id: 'overview', label: 'Overview', to: '/p/alpha', ready: true }), expect.objectContaining({ id: 'issues', ready: false })]), agents: [expect.objectContaining({ id: 'claude-code' })] } } })
    expect(textOf(events)).toMatch(/^In Alpha you can open Overview, Issues.* and chat with Claude Code\.$/)
    expect(events.at(-1)).toMatchObject({ kind: 'turn_end', stopReason: 'end_turn' })

    const listed = await json<{ threads: { id: string, working: boolean, unread: boolean, title: string | null }[] }>(await call('GET', projectThreadsPath('alpha', PLATFORM_AGENT_ID)), 200)
    expect(listed.threads).toEqual([expect.objectContaining({ id: thread.thread.id, working: false, unread: true, title: 'Describe the platform for me' })])
  })

  it('returns a navigate action the browser applies, and remembers the conversation on the next turn', async () => {
    await boot()
    await project()
    await configureGateway()

    const { thread, events } = await converse('open overview')
    expect(kindsOf(events)).toEqual(['prompt', 'tool_call', 'tool_result', 'client_action', 'text', 'turn_end'])
    expect(events[3]).toMatchObject({ kind: 'client_action', action: { kind: 'navigate', to: '/p/alpha', viewId: 'overview', projectSlug: 'alpha', capabilityId: 'overview' } })
    expect(textOf(events)).toBe('The browser opens Overview for Alpha.')

    gateway!.requests.length = 0
    const ended = new Promise<void>((resolve) => {
      const unsubscribe = platform!.sessions.subscribe(thread.session.id, (message) => {
        if (message.type === 'event' && message.event.kind === 'turn_end') {
          unsubscribe()
          resolve()
        }
      })
    })
    await json(await call('POST', threadPromptPath('alpha', thread.thread.id), { text: 'thanks' }), 202)
    await ended
    const history = gateway!.requests[0]!.messages.filter(m => m.role === 'user').map(m => m.content)
    expect(history).toEqual(['open overview', 'thanks'])
  })

  it('returns an open_thread action for an agent the actor may chat with', async () => {
    await boot()
    const alpha = await project()
    healthyClaude(alpha.id)
    await configureGateway()

    const { events } = await converse('chat with claude-code')
    expect(events.find(e => e.kind === 'client_action')).toMatchObject({ action: { kind: 'open_thread', agentId: 'claude-code' } })
    expect(textOf(events)).toBe('The browser opens a new thread with Claude Code.')
  })

  it('relays a refusal for a view the actor cannot see, without any action', async () => {
    await boot()
    await project()
    await configureGateway()

    const { events } = await converse('open issues', DEVELOPER)
    expect(kindsOf(events)).toEqual(['prompt', 'tool_call', 'tool_result', 'text', 'turn_end'])
    expect(events[2]).toMatchObject({ kind: 'tool_result', update: { rawOutput: { refused: true, code: 'not_granted' } } })
    expect(textOf(events)).toMatch(/^I can't do that: Rung 'none' of 'issues' does not show view 'issues'/)
  })

  it('fails the turn cleanly when the gateway is removed between the thread and the prompt', async () => {
    await boot()
    await project()
    await configureGateway()
    const thread = await json<ChatThreadResponse>(await call('POST', projectThreadsPath('alpha'), { agentId: PLATFORM_AGENT_ID }), 201)
    await json(await call('PUT', PLATFORM_SETTINGS_PATH, { modelId: null }), 200)

    const refused = await call('POST', threadPromptPath('alpha', thread.thread.id), { text: 'hello' })
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as ApiErrorBody).error.code).toBe('not_ready')
    expect(platform!.sessions.events(thread.session.id)).toEqual([])
  })
})
