import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CAPABILITY_CATALOG_PATH, GRANTS_PATH, MODULES_PATH, PROJECTS_PATH, botSlackConnectionPath, projectNotificationsPath, type CapabilityCatalogResponse, type GrantListResponse, type ModuleListResponse, type NotificationRulesResponse } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins } from '../acp/test-support'
import { appendActivityEvent } from '../activity/events'
import { BOT_SLACK_ROUTER } from '../bots/definition'
import { CapabilityDefinitionError } from '../capabilities/definition'
import { ACP_SESSIONS } from '../chat-claude-code/definition'
import { capabilityDefinitions } from '../definitions'
import { MODULES } from '../modules'
import type { Platform } from '../platform'
import { createTestApp, startTestPlatform, type TestPlatformOptions } from '../testing/platform'
import { PLUGIN_TYPES } from '../plugins'
import { createPluginInstance } from '../plugins/instances/instances'
import { slackPluginType } from '../plugins/types/slack'
import { createProject } from '../projects/projects'
import { MasterKey } from '../secrets'
import { createTempDataDir, type TempDataDir } from '../testing'
import { SLACK_CONNECTIONS } from './definition'
import { SLACK_NOTIFICATION_CHANNEL_ID } from './notifications'

const WEB_URL = 'http://web.test:4300'
const MCP_SERVER = 'candy_mountain_slack'
const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the slack definition', () => {
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
    const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, pluginTypes: platform.pluginTypes, families: platform.families, secrets: platform.secrets.writeOnly, secretsReader: platform.secrets, runtime: platform.runtime })
    return { platform, app }
  }

  const withSlack = (): TestPlatformOptions => ({ capabilities: capabilityDefinitions({ chatClaudeCode: { acp }, slack: { fetch: fakeFetch } }) })
  // Bots depend on slack, so a product without it leaves them out too.
  const withoutSlack = (): TestPlatformOptions => ({
    capabilities: capabilityDefinitions({ chatClaudeCode: { acp } }).filter(c => c.id !== 'slack' && c.id !== 'bots'),
    modules: MODULES.map(m => ({ ...m, capabilities: m.capabilities.filter(c => c.capabilityId !== 'bots') })),
  })

  async function projectWithRule(platform: Platform, app: ReturnType<typeof createTestApp>, checkout: string) {
    const project = await createProject(platform.db, { name: 'alpha', source: { kind: 'local-path', path: checkout } })
    const res = await app.request(projectNotificationsPath('alpha'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { 'incident.opened': { enabled: true, destination: { channelId: 'C777' } } } }) })
    expect(res.status).toBe(200)
    return project
  }

  const rules = async (app: ReturnType<typeof createTestApp>) => ((await (await app.request(projectNotificationsPath('alpha'))).json()) as NotificationRulesResponse).rules

  it('offers the connections to bots, brings the plugin type, and is in no catalog, module or grant', async () => {
    const { platform, app } = start(withSlack())

    const connections = platform.runtime.service(SLACK_CONNECTIONS)
    expect(connections).toBeDefined()
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

  it('offers the Slack MCP server to Slack-held bot sessions through the platform host', async () => {
    const { platform } = start(withSlack())
    const sessions = platform.runtime.service(ACP_SESSIONS)!
    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-slack-'))
    try {
      const project = await createProject(platform.db, { name: 'alpha', source: { kind: 'local-path', path: checkout } })
      const plain = sessions.create({ projectId: project.id, family: 'claude-code', actorId: 'u', cwd: checkout })
      const held = sessions.create({ projectId: project.id, family: 'claude-code', actorId: 'u', cwd: checkout, posture: { bot: { id: 'b', name: 'B', holder: { kind: 'slack', id: 'b:C1:1.1' } } } })

      expect(platform.runtime.mcpServers.map(s => s.name)).toEqual([MCP_SERVER])
      expect(await platform.agentMcp.serversFor(plain)).toEqual([])
      expect(await platform.agentMcp.serversFor(held)).toMatchObject([{ name: MCP_SERVER, tools: ['post_blocks'] }])
    }
    finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })

  it('delivers notifications through its channel with the Slack text unchanged', async () => {
    const { platform, app } = start(withSlack())
    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-slack-'))
    try {
      expect(platform.runtime.notificationChannels.map(c => c.id)).toEqual([SLACK_NOTIFICATION_CHANNEL_ID])
      const project = await projectWithRule(platform, app, checkout)
      createPluginInstance({ db: platform.db, pluginTypes: platform.pluginTypes, secrets: platform.secrets.writeOnly }, { type: 'slack', scope: 'global', projectId: null, config: {}, secrets: { botToken: 'xoxb-plugin' } })

      appendActivityEvent(platform.db, { projectId: project.id, type: 'incident.opened', title: 'API <down> & out', link: '/p/alpha/uptime' })
      await platform.notifications.idle()

      expect(posts).toEqual([{ token: 'xoxb-plugin', body: { channel: 'C777', text: `API &lt;down&gt; &amp; out\n<${WEB_URL}/p/alpha/uptime|Open in Candy Mountain>` } }])
      expect((await rules(app))['incident.opened']).toMatchObject({ lastDeliveredAt: expect.any(String), lastFailureAt: null })
    }
    finally {
      rmSync(checkout, { recursive: true, force: true })
    }
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
    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-slack-'))
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
      expect((await app.request(PROJECTS_PATH)).status).toBe(200)

      const project = await projectWithRule(platform, app, checkout)
      appendActivityEvent(platform.db, { projectId: project.id, type: 'incident.opened', title: 'down' })
      await platform.notifications.idle()
      expect((await rules(app))['incident.opened']).toMatchObject({ lastDeliveredAt: null, lastFailureReason: 'No delivery channel: no capability offers one.' })
      expect(posts).toEqual([])
    }
    finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })

  it('refuses a product that already supplies the slack plugin type', () => {
    temp = createTempDataDir()
    const options: TestPlatformOptions = { pluginTypes: [...PLUGIN_TYPES, slackPluginType] }
    expect(() => startTestPlatform(temp.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, options)).toThrow("Plugin type 'slack' is brought by capability 'slack' but the product already supplies it.")
  })
})
