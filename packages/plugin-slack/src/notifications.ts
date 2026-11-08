import { SLACK_CHANNEL_ID_PATTERN, SLACK_MEMBER_ID_PATTERN, workspaceViewRoute, type NotificationChannelDescription, type ScopeLabel } from '@candy-mountain/platform-sdk'
import { createPluginSecrets, type NotificationChannel, type PluginInstanceDeps, resolvePluginInstance, type SecretsReader } from '@candy-mountain/platform-daemon'
import type { SlackConnections } from './manager'
import { createSlackOperations, type SlackOperations } from './operations'
import { slackConfig, slackPluginType } from './plugin-type'

export interface SlackNotificationChannelDeps extends PluginInstanceDeps {
  secretsReader: SecretsReader
  /** Without an attached source only the project's Slack plugin can post. */
  slack: Pick<SlackConnections, 'web' | 'source'>
  scopeUrlPrefix: string
  scopeLabel: ScopeLabel
}

export interface SlackNotificationChannelOptions {
  fetch?: typeof fetch
}

export const SLACK_NOTIFICATION_CHANNEL_ID = 'slack'

const escapeMrkdwn = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const SLACK_DESTINATIONS: NotificationChannelDescription['destinations'] = {
  channel: { label: 'Channel', placeholder: 'C0123ABCD', help: 'Slack channel ID, starts with C or G. Invite the bot to private channels.', pattern: SLACK_CHANNEL_ID_PATTERN.source, mismatch: 'Not a Slack channel ID. Expected something like C0123ABCD.' },
  member: { label: 'Direct message', placeholder: 'U0123ABCD', help: 'Slack member ID, starts with U or W. Find it in the member profile.', pattern: SLACK_MEMBER_ID_PATTERN.source, mismatch: 'Not a Slack member ID. Expected something like U0123ABCD.' },
}

/** Posts as the project's first bot with a Slack bot token (by name), else as the project's Slack plugin; declines when there is neither. */
export function slackNotificationChannel(deps: SlackNotificationChannelDeps, { fetch }: SlackNotificationChannelOptions = {}): NotificationChannel {
  const botsWithToken = (projectId: string) => deps.slack.source()?.notificationSenders(projectId) ?? []

  function resolveSender(projectId: string, signal: AbortSignal): SlackOperations | null {
    for (const { id } of botsWithToken(projectId)) {
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
    describe(workspace) {
      const bot = botsWithToken(workspace.id)[0]
      let sender = bot ? `${deps.scopeLabel.singularTitle} bot ${bot.name}` : null
      if (!sender && resolvePluginInstance(deps, workspace.id, slackPluginType.id)?.secrets.botToken === 'set') sender = `${deps.scopeLabel.singularTitle} Slack plugin`
      return {
        label: 'Slack',
        sender,
        setupHelp: `Add a Slack bot token to one of this ${deps.scopeLabel.singular}'s bots, or configure the Slack plugin.`,
        setup: { label: 'Set up Slack', link: workspaceViewRoute(deps.scopeUrlPrefix, workspace.slug, 'setup/plugins') },
        destinations: SLACK_DESTINATIONS,
      }
    },
  }
}
