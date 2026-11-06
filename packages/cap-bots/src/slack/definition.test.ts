import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CAPABILITY_CATALOG_PATH, GRANTS_PATH, MODULES_PATH, WORKSPACES_PATH, workspaceNotificationsPath, type CapabilityCatalogResponse, type GrantListResponse, type ModuleListResponse, type NotificationRulesResponse } from '@candy-mountain/platform-sdk'
import { botSlackConnectionPath } from '../wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendActivityEvent, createTempDataDir, fixtureDefinition, MasterKey, platformApp, startTestPlatform, testProduct, type Platform, type TempDataDir, type TestPlatformOptions } from '@candy-mountain/platform-daemon'
import { BOT_SLACK_ROUTER } from '../definition'
import { SLACK_CONNECTIONS } from '@candy-mountain/cap-slack'
import { ACP_SESSIONS, fakeBins } from '@candy-mountain/cap-chat-claude-code'
import { botsTestProduct } from '../test-support'
import { createWorkspaceWithRepository } from '@candy-mountain/cap-repository'

const WEB_URL = 'http://web.test:4300'
const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the slack definition under bots', () => {
  let temp: TempDataDir
  const open: Platform[] = []
  const posts: Array<{ token: string, body: Record<string, unknown> }> = []

  const fakeFetch: typeof fetch = async (input, init) => {
    const token = String(new Headers(init?.headers).get('authorization')).replace('Bearer ', '')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (!String(input).endsWith('chat.postMessage')) return Response.json({ ok: false, error: 'unknown_method' })
    posts.push({ token, body })
    return Response.json({ ok: true, channel: body.channel, ts: '1.2' })
  }

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    posts.length = 0
    vi.restoreAllMocks()
  })

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, { secretsKey: MasterKey.generate(), notifications: { webUrl: WEB_URL, log: { error: () => {} } }, ...options })
    open.push(platform)
    return { platform, app: platformApp(platform) }
  }

  const withSlack = (): TestPlatformOptions => ({ product: botsTestProduct({ acp, slack: { fetch: fakeFetch } }) })
  // Stands in for a capability with a notification kind, so the rules route has something to store without slack.
  const incidents = fixtureDefinition('incidents', { manifest: null, activityEventTypes: [{ id: 'incident.opened', label: 'Incident opened', icon: 'i-lucide-siren', notifications: [{ id: 'incident.opened', label: 'An incident opens' }] }] })
  // Bots depend on slack, and team on the hasBots fact bots declares, so a product without it leaves both out too.
  const withoutSlack = (): TestPlatformOptions => {
    const product = botsTestProduct({ acp }, ['slack', 'bots', 'team'])
    return { product: testProduct({ capabilities: [...product.capabilities, incidents], modules: product.modules }) }
  }

  async function projectWithRule(platform: Platform, app: ReturnType<typeof platformApp>, checkout: string) {
    const project = await createWorkspaceWithRepository(platform.db, { name: 'alpha', path: checkout })
    const res = await app.request(workspaceNotificationsPath('alpha'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { 'incident.opened': { enabled: true, destination: { channelId: 'C777' } } } }) })
    expect(res.status).toBe(200)
    return project
  }

  const rules = async (app: ReturnType<typeof platformApp>) => ((await (await app.request(workspaceNotificationsPath('alpha'))).json()) as NotificationRulesResponse).rules

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
    const { platform } = start(withSlack())
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

    await platform.close()
    expect(order).toEqual(['router', 'sessions', 'connections'])
    expect(connections.status('b1')).toMatchObject({ state: 'disconnected', reasonCode: 'stopped' })
  })

  it('boots without it and bots: no plugin type, no MCP server, no channel, no routing, no status route, and notifications report no channel', async () => {
    const { platform, app } = start(withoutSlack())
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

      const project = await projectWithRule(platform, app, checkout)
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
