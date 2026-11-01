import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition } from '../capabilities/definition'
import { slackPluginType } from '../plugins/types/slack'
import { startSlackConnections, type SlackConnections, type SlackConnectionsOptions } from './manager'
import { slackMcpServer } from './mcp'
import { slackNotificationChannel } from './notifications'

export const SLACK_CAPABILITY_ID = 'slack'

/** The Socket Mode connections for dependents that declare `dependsOn: ['slack']`: the bots definition runs the router, decisions, handoffs and status route over them. */
export const SLACK_CONNECTIONS = serviceKey<SlackConnections>('slack.connections')

export interface SlackOptions {
  connections?: SlackConnectionsOptions
  /** Outbound fetch for the MCP server and the notification channel; a test seam. */
  fetch?: typeof fetch
  /** Stands in for the live connections' Web API in the MCP server and the notification channel; a test seam. */
  web?: Pick<SlackConnections, 'web'>
}

/** Service-only: no manifest, so no views, no ladder, and nothing in the catalog, modules or grants. */
export function slackDefinition(options: SlackOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: SLACK_CAPABILITY_ID,
    pluginTypes: [slackPluginType],
    provides: [SLACK_CONNECTIONS],
    start({ db, secrets, pluginTypes }) {
      const connections = startSlackConnections({ db, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets }, options.connections)
      const web = options.web ?? connections
      return {
        services: [bindService(SLACK_CONNECTIONS, connections)],
        mcpServers: [slackMcpServer({ db, slack: web }, { fetch: options.fetch })],
        notificationChannels: [slackNotificationChannel({ db, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets, slack: web }, { fetch: options.fetch })],
        close: () => connections.close(),
      }
    },
  })
}
