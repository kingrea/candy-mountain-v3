import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CAPABILITY_CATALOG_PATH, GRANTS_PATH, MODULES_PATH, WORKSPACES_PATH, workspaceNotificationsPath, type CapabilityCatalogResponse, type GrantListResponse, type ModuleListResponse, type NotificationRulesResponse } from '@crab-shack/platform-sdk'
import { botSlackConnectionPath } from '../wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendActivityEvent } from '@crab-shack/platform-daemon'
import { fixtureDefinition, testKit, testProduct, type TestActor, type TestKit, type TestKitOptions } from '@crab-shack/platform-daemon/testing'
import { BOT_SLACK_ROUTER } from '../definition'
import { SLACK_CONNECTIONS } from '@candy-mountain/plugin-slack'
import { ACP_SESSIONS } from '@candy-mountain/cap-acp'
import { fakeBins } from '@candy-mountain/testing'
import { botsTestProduct } from '../test-support'
import { setRepository } from '@candy-mountain/plugin-repository'

const WEB_URL = 'http://web.test:4300'
const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the slack definition under bots', () => {
  let kit: TestKit | undefined
  const posts: Array<{ token: string, body: Record<string, unknown> }> = []

  const fakeFetch: typeof fetch = async (input, init) => {
    const token = String(new Headers(init?.headers).get('authorization')).replace('Bearer ', '')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (!String(input).endsWith('chat.postMessage')) return Response.json({ ok: false, error: 'unknown_method' })
    posts.push({ token, body })
    return Response.json({ ok: true, channel: body.channel, ts: '1.2' })
  }

  afterEach(async () => {
    await kit?.close()
    kit = undefined
    posts.length = 0
    vi.restoreAllMocks()
  })

  function start(options: TestKitOptions = {}) {
    kit = testKit({ notifications: { webUrl: WEB_URL, log: { error: () => {} } }, ...options })
    return { kit, platform: kit.platform, app: kit.admin }
  }

  const withSlack = (): TestKitOptions => ({ product: botsTestProduct({ acp, slack: { fetch: fakeFetch } }) })
  // Stands in for a capability with a notification kind, so the rules route has something to store without slack.
  const incidents = fixtureDefinition('incidents', { manifest: null, activityEventTypes: [{ id: 'incident.opened', label: 'Incident opened', icon: 'i-lucide-siren', notifications: [{ id: 'incident.opened', label: 'An incident opens' }] }] })
  // Bots depend on slack, and team on the hasBots fact bots declares, so a product without it leaves both out too.
  const withoutSlack = (): TestKitOptions => {
    const product = botsTestProduct({ acp }, ['slack', 'bots', 'team'])
    return { product: testProduct({ capabilities: [...product.capabilities, incidents], modules: product.modules }) }
  }

  async function projectWithRule(kit: TestKit, checkout: string) {
    const app = kit.admin
    const project = kit.workspace({ name: 'alpha', slug: 'alpha' })
    await setRepository(kit.db, project.id, { kind: 'local-path', path: checkout })
    const res = await app.request(workspaceNotificationsPath('alpha'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { 'incident.opened': { enabled: true, destination: { channelId: 'C777' } } } }) })
    expect(res.status).toBe(200)
    return project
  }

  const rules = async (app: TestActor) => ((await (await app.request(workspaceNotificationsPath('alpha'))).json()) as NotificationRulesResponse).rules

  it('offers the connections to bots, brings the plugin type, and is in no catalog, module or grant', async () => {
    const { platform, app } = start(withSlack())

    const connections = platform.runtime.service(SLACK_CONNECTIONS)
    expect(connections).toBeDefined()
    // Bots attach their bots at start; slack itself never reads them.
    expect(connections!.source()).not.toBeNull()
    expect(platform.runtime.services('slack').get(SLACK_CONNECTIONS)).toBe(connections)
    expect(platform.runtime.service(BOT_SLACK_ROUTER)).toBeDefined()
    expect(platform.pluginTypes.has('slack')).toBe(true)
    const started = platform.runtime.started.map(s => s.definition.id)
    expect(started).toContain('slack')
    // Started before bots, which depends on it.
    expect(started.indexOf('slack')).toBeLessThan(started.indexOf('bots'))

    expect(platform.capabilities.has('slack')).toBe(false)
    expect(platform.capabilities.definitions().map(d => d.id)).toContain('slack')
    expect(platform.modules.list().flatMap(m => m.capabilities.map(c => c.capabilityId))).not.toContain('slack')
    const catalog = (await (await app.request(CAPABILITY_CATALOG_PATH)).json()) as CapabilityCatalogResponse
    expect(catalog.capabilities.map(c => c.id)).not.toContain('slack')
    expect(catalog.capabilities.map(c => c.id)).toContain('bots')
    const modules = (await (await app.request(MODULES_PATH)).json()) as ModuleListResponse
    expect(JSON.stringify(modules)).not.toContain('"slack"')
    const grants = (await (await app.request(GRANTS_PATH)).json()) as GrantListResponse
    expect(grants.grants.length).toBeGreaterThan(0)
    expect(JSON.stringify(grants)).not.toContain('"slack"')
  })

  it('closes its connections after the router and after the sessions that may still post', async () => {
    const { kit, platform } = start(withSlack())
    const connections = platform.runtime.services('slack').get(SLACK_CONNECTIONS)
    const sessions = platform.runtime.service(ACP_SESSIONS)!
    const order: string[] = []
    const record = <T extends object, K extends keyof T & string>(target: T, method: K, name: string) => {
      const original = (target[method] as unknown as (...args: unknown[]) => unknown).bind(target)
      vi.spyOn(target, method as never).mockImplementation(((...args: unknown[]) => {
        order.push(name)
        return original(...args)
      }) as never)
    }
    record(platform.runtime.services('bots').get(BOT_SLACK_ROUTER), 'close', 'router')
    record(sessions, 'close', 'sessions')
    record(connections, 'close', 'connections')

    await kit.close()
    expect(order).toEqual(['router', 'sessions', 'connections'])
    expect(connections.status('b1')).toMatchObject({ state: 'disconnected', reasonCode: 'stopped' })
  })

  it('boots without it and bots: no plugin type, no MCP server, no channel, no routing, no status route, and notifications report no channel', async () => {
    const { kit, platform, app } = start(withoutSlack())
    const checkout = mkdtempSync(join(tmpdir(), 'cap-bots-slack-'))
    try {
      const started = platform.runtime.started.map(s => s.definition.id)
      expect(started).not.toContain('slack')
      expect(started).toContain('chat-claude-code')
      expect(started).not.toContain('bots')
      expect(platform.pluginTypes.has('slack')).toBe(false)
      expect(platform.runtime.service(SLACK_CONNECTIONS)).toBeUndefined()
      expect(platform.runtime.service(BOT_SLACK_ROUTER)).toBeUndefined()
      expect(platform.runtime.mcpServers).toEqual([])
      expect(platform.runtime.notificationChannels).toEqual([])
      const status = await app.request(botSlackConnectionPath('nope', 'b1'))
      expect(status.status).toBe(404)
      expect(await status.text()).toBe('404 Not Found')
      expect((await app.request(WORKSPACES_PATH)).status).toBe(200)

      const project = await projectWithRule(kit, checkout)
      appendActivityEvent(platform.db, { workspaceId: project.id, type: 'incident.opened', title: 'down' })
      await platform.notifications.idle()
      expect((await rules(app))['incident.opened']).toMatchObject({ lastDeliveredAt: null, lastFailureReason: 'No delivery channel: no capability offers one.' })
      expect(posts).toEqual([])
    }
    finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })
})
