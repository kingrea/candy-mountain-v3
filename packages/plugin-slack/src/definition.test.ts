import { CAPABILITY_CATALOG_PATH, workspaceNotificationsPath, type AgentSession, type CapabilityCatalogResponse, type NotificationRulesResponse } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { appendActivityEvent, CapabilityDefinitionError } from '@candy-mountain/platform-daemon'
import { fixtureDefinition, testKit, type TestKit, type TestKitOptions } from '@candy-mountain/platform-daemon/testing'
import { SLACK_CONNECTIONS, slackDefinition } from './definition'
import { SLACK_POST_BLOCKS_TOOL } from './mcp'
import { SLACK_NOTIFICATION_CHANNEL_ID } from './notifications'
import { slackPluginType } from './plugin-type'

const WEB_URL = 'http://web.test:4300'

// Something has to declare a notification kind for a rule to be set.
const incidents = fixtureDefinition('incidents', {
  manifest: null,
  activityEventTypes: [{ id: 'incident.opened', label: 'Incident opened', icon: 'i-lucide-siren', notifications: [{ id: 'incident.opened', label: 'An incident opens' }] }],
})

const session = (holder?: 'slack' | 'console') => ({
  id: `s-${holder ?? 'plain'}`,
  posture: holder ? { bot: { id: 'b', name: 'B', holder: { kind: holder, id: 'b:C1:1.1' } } } : undefined,
}) as unknown as AgentSession

describe('the slack definition', () => {
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
  })

  function start(options: TestKitOptions = {}) {
    kit = testKit({ notifications: { webUrl: WEB_URL, log: { error: () => {} } }, ...options })
    return { platform: kit.platform, app: kit.admin }
  }

  const withSlack = (): TestKitOptions => ({ capabilities: [incidents, slackDefinition({ fetch: fakeFetch })] })

  it('offers the connections, brings the plugin type, and is in no catalog', async () => {
    const { platform, app } = start(withSlack())

    const connections = platform.runtime.service(SLACK_CONNECTIONS)
    expect(connections).toBeDefined()
    expect(platform.runtime.services('slack').get(SLACK_CONNECTIONS)).toBe(connections)
    expect(connections!.source()).toBeNull()
    expect(platform.pluginTypes.has('slack')).toBe(true)
    expect(platform.runtime.started.map(s => s.definition.id)).toContain('slack')

    expect(platform.capabilities.has('slack')).toBe(false)
    expect(platform.capabilities.definitions().map(d => d.id)).toContain('slack')
    const catalog = (await (await app.request(CAPABILITY_CATALOG_PATH)).json()) as CapabilityCatalogResponse
    expect(catalog.capabilities.map(c => c.id)).not.toContain('slack')
  })

  it('offers the Slack MCP server to Slack-held sessions only, through the platform host', async () => {
    const { platform } = start(withSlack())

    expect(platform.runtime.mcpServers.map(s => s.name)).toEqual([SLACK_POST_BLOCKS_TOOL.server])
    expect(await platform.agentMcp.serversFor(session())).toEqual([])
    expect(await platform.agentMcp.serversFor(session('console'))).toEqual([])
    expect(await platform.agentMcp.serversFor(session('slack'))).toMatchObject([{ name: SLACK_POST_BLOCKS_TOOL.server, tools: [SLACK_POST_BLOCKS_TOOL.tool] }])
  })

  it('delivers notifications through the project\'s Slack plugin while no bots are attached', async () => {
    const { platform, app } = start(withSlack())
    expect(platform.runtime.notificationChannels.map(c => c.id)).toEqual([SLACK_NOTIFICATION_CHANNEL_ID])
    const workspace = kit!.workspace({ name: 'alpha', slug: 'alpha' })
    const res = await app.request(workspaceNotificationsPath('alpha'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules: { 'incident.opened': { enabled: true, destination: { channelId: 'C777' } } } }) })
    expect(res.status).toBe(200)
    kit!.pluginInstance({ type: 'slack', workspace, secrets: { botToken: 'xoxb-plugin' } })

    appendActivityEvent(platform.db, { workspaceId: workspace.id, type: 'incident.opened', title: 'API <down> & out', link: '/w/alpha/uptime' })
    await platform.notifications.idle()

    expect(posts).toEqual([{ token: 'xoxb-plugin', body: { channel: 'C777', text: `API &lt;down&gt; &amp; out\n<${WEB_URL}/w/alpha/uptime|Open in Candy Mountain>` } }])
    const rules = ((await (await app.request(workspaceNotificationsPath('alpha'))).json()) as NotificationRulesResponse).rules
    expect(rules['incident.opened']).toMatchObject({ lastDeliveredAt: expect.any(String), lastFailureAt: null })
  })

  it('stops its connections when the platform closes', async () => {
    const { platform } = start(withSlack())
    const connections = platform.runtime.service(SLACK_CONNECTIONS)!
    await kit!.close()
    expect(connections.status('b1')).toMatchObject({ state: 'disconnected', reasonCode: 'stopped' })
  })

  it('leaves no plugin type, MCP server or channel behind when the product boots without it', () => {
    const { platform } = start({ capabilities: [incidents] })
    expect(platform.pluginTypes.has('slack')).toBe(false)
    expect(platform.runtime.service(SLACK_CONNECTIONS)).toBeUndefined()
    expect(platform.runtime.mcpServers).toEqual([])
    expect(platform.runtime.notificationChannels).toEqual([])
  })

  it('refuses a product that already supplies the slack plugin type', () => {
    const options = { capabilities: [slackDefinition()], pluginTypes: [slackPluginType] }
    expect(() => testKit(options)).toThrow(CapabilityDefinitionError)
    expect(() => testKit(options)).toThrow("Plugin type 'slack' is brought by capability 'slack' but the product already supplies it.")
  })
})
