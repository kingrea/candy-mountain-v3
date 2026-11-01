import { eq, sql } from 'drizzle-orm'
import { botSecretOwner } from '../bots/bots'
import type { NotificationChannel } from '../capabilities/definition'
import { bots } from '../db/schema'
import { resolvePluginInstance, type PluginInstanceDeps, type SecretsReader } from '../plugins/instances/instances'
import { createPluginSecrets } from '../plugins/secrets'
import { createSlackOperations, slackConfig, slackPluginType, type SlackOperations } from '../plugins/slack'
import type { SlackConnections } from './manager'

export interface SlackNotificationChannelDeps extends PluginInstanceDeps {
  secretsReader: SecretsReader
  slack: Pick<SlackConnections, 'web'>
}

export interface SlackNotificationChannelOptions {
  fetch?: typeof fetch
}

export const SLACK_NOTIFICATION_CHANNEL_ID = 'slack'

const escapeMrkdwn = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Posts as the project's first bot with a Slack bot token (by name), else as the platform Slack plugin; declines when there is neither. */
export function slackNotificationChannel(deps: SlackNotificationChannelDeps, { fetch }: SlackNotificationChannelOptions = {}): NotificationChannel {
  function resolveSender(projectId: string, signal: AbortSignal): SlackOperations | null {
    const rows = deps.db.select({ id: bots.id }).from(bots).where(eq(bots.projectId, projectId)).orderBy(sql`lower(${bots.name})`, bots.createdAt).all()
    for (const { id } of rows) {
      if (!deps.secrets.isSet(botSecretOwner(id), 'slackBotToken')) continue
      const web = deps.slack.web(id, { fetch, signal })
      if (web) return web.operations
    }
    const instance = resolvePluginInstance(deps, projectId, slackPluginType.id)
    if (!instance) return null
    const secrets = createPluginSecrets(deps.secretsReader, instance.id, slackPluginType)
    return createSlackOperations(slackConfig(instance.config), secrets, { fetch, signal })
  }

  return {
    id: SLACK_NOTIFICATION_CHANNEL_ID,
    async deliver({ workspaceId, destination, title, url }, signal) {
      const sender = resolveSender(workspaceId, signal)
      if (!sender) return false
      const target = 'channelId' in destination ? { channel: destination.channelId } : { memberId: destination.memberId }
      await sender.postMessage({ ...target, text: `${escapeMrkdwn(title)}\n<${url}|Open in Candy Mountain>` })
      return true
    },
  }
}
