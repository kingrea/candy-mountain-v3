import { mkdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { PLATFORM_AGENT_ID, PLATFORM_SETTINGS_PATH, PROJECTS_PATH, projectRegistryPath, projectThreadsPath, threadPromptPath, type Actor, type AgentSessionEvent, type ApiErrorBody, type ChatThreadResponse, type RegistryResponse } from '@candy-mountain/shared'
import { Mastra } from '@mastra/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthStrategy } from '../auth'
import { ACP_SESSIONS } from '../chat-claude-code/definition'
import type { Platform } from '../platform'
import { createProject } from '../projects/projects'
import { MasterKey } from '../secrets'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createTestApp, startTestPlatform, withoutCapabilities, type TestPlatformOptions } from '../testing/platform'
import { THREAD_SESSIONS } from '../threads/sessions'
import { PLATFORM_AGENT, PLATFORM_FAMILY } from './definition'
import { scriptedReply, startStubGateway, type StubGateway } from './test-support'

const ADMIN: Actor = { id: 'admin-actor', username: 'admin', displayName: 'Admin', roles: ['admin'] }
const as = (actor: Actor): AuthStrategy => ({ name: 'development', resolve: () => actor })

/** Answers the first SSE chunk and then holds the response open, so a turn stays mid-stream until it is aborted. */
function startStalledGateway(): Promise<{ url: string, requests: number, close(): Promise<void> }> {
  const gateway = { url: '', requests: 0, close: async () => {} }
  const server: Server = createServer((_req, res) => {
    gateway.requests += 1
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(`data: ${JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub-model', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      gateway.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
      gateway.close = () => new Promise((done) => {
        server.closeAllConnections()
        server.close(() => done())
      })
      resolve(gateway)
    })
  })
}

describe('the platform-agent definition', () => {
  let temp: TempDataDir
  let gateway: StubGateway | undefined
  let stalled: Awaited<ReturnType<typeof startStalledGateway>> | undefined
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    await gateway?.close()
    await stalled?.close()
    gateway = stalled = undefined
    temp?.cleanup()
    vi.restoreAllMocks()
  })

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, { secretsKey: MasterKey.generate(), ...options })
    open.push(platform)
    const app = createTestApp({ db: platform.db, paths: platform.paths, auth: as(ADMIN), capabilities: platform.capabilities, modules: platform.modules, pluginTypes: platform.pluginTypes, families: platform.families, secrets: platform.secrets.writeOnly, secretsReader: platform.secrets, runtime: platform.runtime })
    const call = (method: string, path: string, body?: unknown) => app.request(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
    return { platform, app, call }
  }

  async function json<T>(res: Response, status: number): Promise<T> {
    expect(res.status, await res.clone().text()).toBe(status)
    return res.json() as Promise<T>
  }

  async function project(platform: Platform): Promise<void> {
    const path = join(temp.root, '..', 'repos', 'alpha')
    mkdirSync(path, { recursive: true })
    await createProject(platform.db, { name: 'Alpha', slug: 'alpha', source: { kind: 'local-path', path } })
  }

  const configureGateway = async (call: ReturnType<typeof start>['call'], url: string) => json(await call('PUT', PLATFORM_SETTINGS_PATH, { gatewayBaseUrl: url, gatewayKey: 'sk-stub-key', modelId: 'stub-model' }), 200)

  /** Prompts the thread and resolves with the session log once its turn has ended. */
  async function converse(platform: Platform, call: ReturnType<typeof start>['call'], text: string): Promise<AgentSessionEvent[]> {
    const sessions = platform.runtime.service(THREAD_SESSIONS)!
    const thread = await json<ChatThreadResponse>(await call('POST', projectThreadsPath('alpha'), { agentId: PLATFORM_AGENT_ID }), 201)
    const ended = new Promise<void>((resolve) => {
      const unsubscribe = sessions.subscribe(thread.session.id, (message) => {
        if (message.type === 'event' && message.event.kind === 'turn_end') {
          unsubscribe()
          resolve()
        }
      })
    })
    await json(await call('POST', threadPromptPath('alpha', thread.thread.id), { text }), 202)
    await ended
    return sessions.events(thread.session.id)
  }

  const textOf = (events: AgentSessionEvent[]) => events.filter(e => e.kind === 'text').map(e => (e as { text: string }).text).join('')

  it('registers the platform family and runs it as a chat family, with Mastra and the runner as its service', () => {
    const { platform } = start()

    expect(platform.families.nameOf(PLATFORM_FAMILY.id)).toBe('Platform agent')
    expect(platform.families.ids()).toEqual(['claude-code', 'codex', 'platform'])
    expect(Object.keys(platform.runtime.chatFamilies)).toEqual(['platform'])
    expect(platform.runtime.services('platform-agent').get(PLATFORM_AGENT).run).toBe(platform.runtime.chatFamilies.platform)
    expect(platform.runtime.started.map(s => s.definition.id).at(-1)).toBe('platform-agent')
  })

  it('boots without it: no platform family, no platform agent in the registry, and a platform thread is not found', async () => {
    const { platform, call } = start(withoutCapabilities('platform-agent'))

    expect(platform.families.has('platform')).toBe(false)
    expect(platform.capabilities.has('platform-agent')).toBe(false)
    expect(platform.runtime.chatFamilies).toEqual({})
    expect(platform.runtime.service(PLATFORM_AGENT)).toBeUndefined()
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()

    await project(platform)
    gateway = await startStubGateway(scriptedReply)
    await configureGateway(call, gateway.url)
    const registry = await json<RegistryResponse>(await call('GET', projectRegistryPath('alpha')), 200)
    expect(registry.agents).toEqual([])
    expect(registry.capabilities.map(c => c.id)).not.toContain('platform-agent')
    const refused = await call('POST', projectThreadsPath('alpha'), { agentId: PLATFORM_AGENT_ID })
    expect(refused.status).toBe(404)
    expect(((await refused.json()) as ApiErrorBody).error.code).toBe('not_found')
  })

  it('serves platform agent threads without chat-claude-code, bots or chat-codex', async () => {
    const { platform, call } = start(withoutCapabilities('chat-claude-code', 'bots', 'chat-codex'))

    expect(platform.runtime.service(ACP_SESSIONS)).toBeUndefined()
    expect(platform.families.ids()).toEqual(['platform'])
    expect((await call('GET', `${PROJECTS_PATH}/alpha/sessions`)).status).toBe(404)

    await project(platform)
    gateway = await startStubGateway(scriptedReply)
    await configureGateway(call, gateway.url)
    const events = await converse(platform, call, 'hello')
    expect(gateway.requests[0]).toMatchObject({ model: 'stub-model', authorization: 'Bearer sk-stub-key' })
    expect(events[0]).toMatchObject({ kind: 'prompt', text: 'hello' })
    expect(textOf(events)).toBe('Echo: hello')
    expect(events.at(-1)).toMatchObject({ kind: 'turn_end', stopReason: 'end_turn' })
  })

  it('cancels a turn still streaming before Mastra shuts down, and the store closes after both', async () => {
    const { platform, call } = start(withoutCapabilities('chat-claude-code', 'bots', 'chat-codex'))
    const sessions = platform.runtime.service(THREAD_SESSIONS)!
    await project(platform)
    stalled = await startStalledGateway()
    await configureGateway(call, stalled.url)

    const thread = await json<ChatThreadResponse>(await call('POST', projectThreadsPath('alpha'), { agentId: PLATFORM_AGENT_ID }), 201)
    await json(await call('POST', threadPromptPath('alpha', thread.thread.id), { text: 'hold on' }), 202)
    await vi.waitFor(() => expect(stalled!.requests).toBe(1))

    const order: string[] = []
    let ended: AgentSessionEvent | undefined
    sessions.subscribe(thread.session.id, (message) => {
      if (message.type === 'status') order.push(`status:${message.status}`)
      else if (message.event.kind === 'turn_end') {
        order.push('turn_end')
        ended = message.event
      }
    })
    const shutdown = Mastra.prototype.shutdown
    vi.spyOn(Mastra.prototype, 'shutdown').mockImplementation(function (this: Mastra, ...args: Parameters<Mastra['shutdown']>) {
      order.push('mastra')
      return shutdown.apply(this, args)
    })
    vi.spyOn(sessions, 'close').mockImplementation(async () => void order.push('store'))

    await platform.close()
    expect(order).toEqual(['turn_end', 'status:idle', 'mastra', 'store'])
    expect(ended).toMatchObject({ kind: 'turn_end', stopReason: 'cancelled' })
  })
})
