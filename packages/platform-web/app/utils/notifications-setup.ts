import type {
  NotificationChannelInfo,
  NotificationDeliveryResponse,
  NotificationDestination,
  NotificationDestinationHint,
  NotificationDestinationType,
  NotificationRule,
} from '@candy-mountain/platform-sdk'

export type DestinationType = NotificationDestinationType
export type DestinationHints = Record<DestinationType, NotificationDestinationHint>

export interface RuleDraft {
  enabled: boolean
  type: DestinationType
  id: string
}

export interface DeliveryState {
  /** The channel deliveries go through, or null when none can deliver for this workspace. */
  active: NotificationChannelInfo | null
  channels: NotificationChannelInfo[]
  hints: DestinationHints
}

/** Used only when the product offers no channel, so any id passes. */
export const PLAIN_DESTINATION_HINTS: DestinationHints = {
  channel: { label: 'Channel', placeholder: '', help: '', pattern: '', mismatch: '' },
  member: { label: 'Direct message', placeholder: '', help: '', pattern: '', mismatch: '' },
}

export function deliveryState(answer: NotificationDeliveryResponse | null | undefined): DeliveryState {
  const channels = answer?.channels ?? []
  const active = channels.find(channel => channel.id === answer?.activeChannelId) ?? null
  return { active, channels, hints: (active ?? channels[0])?.destinations ?? PLAIN_DESTINATION_HINTS }
}

/** The daemon sends a rule for every kind it lists; this only satisfies the index type. */
export const emptyNotificationRule: NotificationRule = Object.freeze({ enabled: false, destination: null, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null })

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

export function draftError(draft: RuleDraft, hints: DestinationHints): string | null {
  const id = draft.id.trim()
  if (!id) return draft.enabled ? 'Enter a destination to turn this on.' : null
  const hint = hints[draft.type]
  return !hint.pattern || new RegExp(hint.pattern).test(id) ? null : hint.mismatch
}

export function draftChanged(draft: RuleDraft, rule: NotificationRule): boolean {
  const saved = ruleToDraft(rule)
  return draft.enabled !== saved.enabled || draft.id.trim() !== saved.id || (saved.id !== '' && draft.type !== saved.type)
}
