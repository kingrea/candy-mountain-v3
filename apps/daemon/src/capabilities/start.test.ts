import { PROJECTS_PATH } from '@candy-mountain/shared'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '../app'
import type { PlatformDatabase } from '../db'
import { createSessionFamilyRegistry } from '../threads/families'
import { openTestDatabase } from '../testing'
import { bindService, CapabilityDefinitionError, serviceKey, type CapabilityDefinition, type CapabilityRuntime } from './definition'
import { fixtureCapabilityContext, fixtureDefinition } from './fixtures'
import { createCapabilityRegistry } from './registry'
import { startCapabilities, type CapabilityStartContext, type StartedCapabilities } from './start'

const COUNTER = serviceKey<{ next(): number }>('counter')

describe('startCapabilities', () => {
  let database: PlatformDatabase
  const open: StartedCapabilities[] = []

  afterEach(async () => {
    for (const started of open.splice(0)) await started.close()
    database?.close()
  })

  function context(definitions: readonly CapabilityDefinition[], overrides: Partial<CapabilityStartContext> = {}): CapabilityStartContext {
    database ??= openTestDatabase()
    return fixtureCapabilityContext(database.db, { capabilities: createCapabilityRegistry(definitions), families: createSessionFamilyRegistry([{ id: 'helper', name: 'Helper' }]), ...overrides })
  }

  function start(definitions: readonly CapabilityDefinition[], overrides?: Partial<CapabilityStartContext>) {
    const started = startCapabilities(context(definitions, overrides))
    open.push(started)
    return started
  }

  it('starts dependencies before dependents regardless of list order and closes in reverse', async () => {
    const events: string[] = []
    const tracked = (id: string, dependsOn: string[] = []) => fixtureDefinition(id, {
      dependsOn,
      start: () => {
        events.push(`start ${id}`)
        return { close: () => void events.push(`close ${id}`) }
      },
    })
    const started = start([tracked('bots', ['chat-claude-code', 'team']), tracked('uptime'), tracked('chat-claude-code', ['team']), tracked('team')])

    expect(started.started.map(s => s.definition.id)).toEqual(['team', 'chat-claude-code', 'bots', 'uptime'])
    expect(events).toEqual(['start team', 'start chat-claude-code', 'start bots', 'start uptime'])
    await started.close()
    expect(events.slice(4)).toEqual(['close uptime', 'close bots', 'close chat-claude-code', 'close team'])
  })

  it('resolves a service for a declared dependent only, and keeps it readable by the platform', () => {
    let count = 0
    const provider = fixtureDefinition('team', { provides: [COUNTER], start: () => ({ services: [bindService(COUNTER, { next: () => ++count })] }) })
    const seen: number[] = []
    const dependent = fixtureDefinition('bots', { dependsOn: ['team'], start: ({ service }) => ({ close: () => void seen.push(service(COUNTER).next()) }) })
    const stranger = fixtureDefinition('issues', { start: ({ service }) => ({ close: () => void service(COUNTER) }) })

    const started = start([dependent, provider])
    expect(started.services('team').get(COUNTER).next()).toBe(1)
    expect(() => started.services('issues')).toThrow("Capability 'issues' is not in the definition list.")
    expect(started.service(COUNTER)?.next()).toBe(2)
    expect(started.service(serviceKey('nobody'))).toBeUndefined()

    const loose = startCapabilities(context([stranger]))
    expect(() => loose.started[0]!.runtime.close!()).toThrow("Capability 'issues' asked for service 'counter', which no declared dependency provides.")
  })

  it('closes once, however often close is called', async () => {
    const close = vi.fn()
    const started = start([fixtureDefinition('team', { start: () => ({ close }) })])
    const first = started.close()
    expect(started.close()).toBe(first)
    await first
    await started.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('refuses a definition that starts without binding what it provides, closing what already started', async () => {
    const closed: string[] = []
    const first = fixtureDefinition('team', { start: () => ({ close: () => void closed.push('team') }) })
    const broken = fixtureDefinition('bots', { provides: [COUNTER], start: () => ({ close: () => void closed.push('bots') }) })

    expect(() => startCapabilities(context([first, broken]))).toThrow("Capability 'bots' provides service 'counter' but did not bind it.")
    await vi.waitFor(() => expect(closed).toEqual(['bots', 'team']))
  })

  it('collects routes, MCP servers, chat families and notification channels across runtimes', async () => {
    const routes = new Hono<AppEnv>()
    routes.get('/:slug/widgets', c => c.json({ slug: c.req.param('slug') }))
    const platform = new Hono<AppEnv>()
    platform.get('/', c => c.json({ ok: true }))
    const runner = vi.fn(async () => undefined)
    const channel = { id: 'pager', deliver: async () => true }
    const server = { name: 'widgets', appliesTo: () => true, tools: [] }
    const a = fixtureDefinition('team', { start: () => ({ workspaceRoutes: [routes], mcpServers: [server], notificationChannels: [channel] }) })
    const b = fixtureDefinition('bots', { start: () => ({ platformRoutes: [{ path: '/widget-sources', routes: platform }], chatFamilies: { helper: runner } }) })

    const started = start([a, b])
    expect(started.mcpServers).toEqual([server])
    expect(started.notificationChannels).toEqual([channel])
    expect(started.chatFamilies).toEqual({ helper: runner })

    const app = new Hono<AppEnv>()
    for (const r of started.workspaceRoutes) app.route(PROJECTS_PATH, r)
    for (const { path, routes: r } of started.platformRoutes) app.route(path, r)
    expect(await (await app.request(`${PROJECTS_PATH}/alpha/widgets`)).json()).toEqual({ slug: 'alpha' })
    expect(await (await app.request('/widget-sources')).json()).toEqual({ ok: true })
  })

  it.each<[string, (id: string) => CapabilityRuntime, string]>([
    ['chat family', () => ({ chatFamilies: { helper: async () => undefined } }), "Chat family 'helper' is run by both capability 'team' and capability 'bots'."],
    ['MCP server', () => ({ mcpServers: [{ name: 'widgets', appliesTo: () => true, tools: [] }] }), "MCP server 'widgets' is offered by both capability 'team' and capability 'bots'."],
    ['notification channel', () => ({ notificationChannels: [{ id: 'pager', deliver: async () => false }] }), "Notification channel 'pager' is offered by both capability 'team' and capability 'bots'."],
  ])('refuses two runtimes claiming the same %s, naming both', (_what, runtime, message) => {
    const list = [fixtureDefinition('team', { start: () => runtime('team') }), fixtureDefinition('bots', { start: () => runtime('bots') })]
    expect(() => startCapabilities(context(list))).toThrow(CapabilityDefinitionError)
    expect(() => startCapabilities(context(list))).toThrow(message)
  })

  it('refuses a runtime running a chat family nobody registered, naming both, and closes what started', async () => {
    const closed: string[] = []
    const list = [
      fixtureDefinition('team', { start: () => ({ close: () => void closed.push('team') }) }),
      fixtureDefinition('bots', { start: () => ({ chatFamilies: { ghost: async () => undefined }, close: () => void closed.push('bots') }) }),
    ]
    expect(() => startCapabilities(context(list))).toThrow(CapabilityDefinitionError)
    await vi.waitFor(() => expect(closed).toEqual(['bots', 'team']))
    expect(() => startCapabilities(context(list))).toThrow("Capability 'bots' runs chat family 'ghost', which is not a registered session family.")
    await vi.waitFor(() => expect(closed).toEqual(['bots', 'team', 'bots', 'team']))
    expect(start(list, { families: createSessionFamilyRegistry([{ id: 'ghost', name: 'Ghost' }]) }).chatFamilies).toHaveProperty('ghost')
  })

  it('runs deletion hooks dependents first and still closes everything when one close throws', async () => {
    const order: string[] = []
    const team = fixtureDefinition('team', { start: () => ({ onWorkspaceDeleted: w => void order.push(`team ${w.id}`), close: () => void order.push('close team') }) })
    const bots = fixtureDefinition('bots', {
      dependsOn: ['team'],
      start: () => ({
        onWorkspaceDeleted: async w => void order.push(`bots ${w.id}`),
        close: () => {
          order.push('close bots')
          throw new Error('bots would not close')
        },
      }),
    })
    const started = startCapabilities(context([team, bots]))

    await started.onWorkspaceDeleted({ id: 'w1' } as never)
    expect(order).toEqual(['bots w1', 'team w1'])
    await expect(started.close()).rejects.toThrow('bots would not close')
    expect(order.slice(2)).toEqual(['close bots', 'close team'])
  })

  it('starts a manifest-only definition to an empty runtime', () => {
    const started = start([fixtureDefinition('team')])
    expect(started.started.map(s => s.runtime)).toEqual([{}])
    expect(started.workspaceRoutes).toEqual([])
  })
})
