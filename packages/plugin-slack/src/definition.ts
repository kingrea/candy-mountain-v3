import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition } from '@crab-shack/platform-sdk/daemon'
import { startSlackConnections, type SlackConnections, type SlackConnectionsOptions } from './manager'
import { slackMcpServer } from './mcp'
import { slackNotificationChannel } from './notifications'
import { slackPluginType } from './plugin-type'

export const SLACK_CAPABILITY_ID = 'slack'

/** The Socket Mode connections for dependents that declare `dependsOn: ['slack']`: the bots definition attaches its bots and runs the router, decisions, handoffs and status route over them. */
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
    package: '@candy-mountain/plugin-slack',
    sdkMajor: 0,
    pluginTypes: [slackPluginType],
    provides: [SLACK_CONNECTIONS],
    start({ db, secrets, pluginTypes, scopeUrlPrefix, scopeLabel }) {
      const connections = startSlackConnections(options.connections)
      const slack: Pick<SlackConnections, 'web' | 'source'> = { web: (options.web ?? connections).web, source: connections.source }
      return {
        services: [bindService(SLACK_CONNECTIONS, connections)],
        mcpServers: [slackMcpServer({ slack }, { fetch: options.fetch })],
        notificationChannels: [slackNotificationChannel({ db, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets, slack, scopeUrlPrefix, scopeLabel }, { fetch: options.fetch })],
        close: () => connections.close(),
      }
    },
  })
}
