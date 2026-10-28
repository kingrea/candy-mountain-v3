import {
  SLACK_CHANNEL_ID_PATTERN,
  SLACK_MEMBER_ID_PATTERN,
  type Bot,
  type NotificationDestination,
  type NotificationRule,
  type PluginInstance,
} from '@candy-mountain/shared'

export type DestinationType = 'channel' | 'member'

export interface RuleDraft {
  enabled: boolean
  type: DestinationType
  id: string
}

export interface SlackIdentity {
  source: 'bot' | 'plugin' | 'none'
  label: string
}

export const DESTINATION_HINTS: Record<DestinationType, { label: string, placeholder: string, help: string }> = {
  channel: { label: 'Channel', placeholder: 'C0123ABCD', help: 'Slack channel ID, starts with C or G. Invite the bot to private channels.' },
  member: { label: 'Direct message', placeholder: 'U0123ABCD', help: 'Slack member ID, starts with U or W. Find it in the member profile.' },
}

export function ruleToDraft(rule: NotificationRule): RuleDraft {
  const destination = rule.destination
  return {
    enabled: rule.enabled,
    type: destination?.memberId ? 'member' : 'channel',
    id: destination?.memberId ?? destination?.channelId ?? '',
  }
}

export function draftDestination(draft: RuleDraft): NotificationDestination | null {
  const id = draft.id.trim()
  if (!id) return null
  return draft.type === 'member' ? { memberId: id } : { channelId: id }
}

export function draftError(draft: RuleDraft): string | null {
  const id = draft.id.trim()
  if (!id) return draft.enabled ? 'Enter a destination to turn this on.' : null
  const pattern = draft.type === 'member' ? SLACK_MEMBER_ID_PATTERN : SLACK_CHANNEL_ID_PATTERN
  return pattern.test(id) ? null : `Not a Slack ${draft.type === 'member' ? 'member' : 'channel'} ID. Expected something like ${DESTINATION_HINTS[draft.type].placeholder}.`
}

export function draftChanged(draft: RuleDraft, rule: NotificationRule): boolean {
  const saved = ruleToDraft(rule)
  return draft.enabled !== saved.enabled || draft.id.trim() !== saved.id || (saved.id !== '' && draft.type !== saved.type)
}

/** Mirrors the dispatcher: the first bot by name with a Slack bot token, else the platform Slack plugin. */
export function slackIdentity(bots: readonly Bot[] | null, instances: readonly PluginInstance[]): SlackIdentity {
  const bot = [...(bots ?? [])]
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.createdAt.localeCompare(b.createdAt))
    .find(candidate => candidate.secrets.slackBotToken === 'set')
  if (bot) return { source: 'bot', label: `Project bot ${bot.name}` }
  const plugin = instances.find(instance => instance.type === 'slack' && instance.secrets.botToken === 'set')
  if (plugin) return { source: 'plugin', label: 'Platform Slack plugin' }
  return { source: 'none', label: 'No Slack identity' }
}
