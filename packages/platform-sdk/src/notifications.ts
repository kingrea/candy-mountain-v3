/** Declared by the capability whose events raise it and registered at boot, so any string the daemon lists. */
export type NotificationKind = string

export interface NotificationKindInfo {
  id: NotificationKind
  /** What the rules page shows, e.g. 'A bot finishes'. */
  label: string
}

/** A channel post or a direct message to one member; Slack ids, not names. */
export type NotificationDestination =
  | { channelId: string, memberId?: undefined }
  | { memberId: string, channelId?: undefined }

export interface NotificationRule {
  enabled: boolean
  /** Required while enabled; a disabled rule may keep one for later. */
  destination: NotificationDestination | null
  /** ISO timestamp of the last delivery that failed; cleared by the next success or by saving the rule. */
  lastFailureAt: string | null
  lastFailureReason: string | null
  lastDeliveredAt: string | null
}

export type NotificationRules = Record<NotificationKind, NotificationRule>

export interface NotificationRulesResponse {
  /** The registered kinds in order; `rules` has one entry for each. */
  kinds: NotificationKindInfo[]
  rules: NotificationRules
}

export interface NotificationRuleUpdate {
  enabled?: boolean
  destination?: NotificationDestination | null
}

/** Kinds left out are unchanged; a kind that is present has its last failure cleared. */
export interface UpdateNotificationRulesRequest {
  rules: Partial<Record<NotificationKind, NotificationRuleUpdate>>
}

export const NOTIFICATION_ERROR_CODES = ['invalid_request'] as const
export type NotificationErrorCode = (typeof NOTIFICATION_ERROR_CODES)[number]

export const workspaceNotificationsPath = (slug: string) => `/workspaces/${slug}/notifications`
export const workspaceNotificationDeliveryPath = (slug: string) => `${workspaceNotificationsPath(slug)}/delivery`

/** `channel` holds a `channelId` destination, `member` a `memberId` one. */
export type NotificationDestinationType = 'channel' | 'member'

export interface NotificationDestinationHint {
  label: string
  placeholder: string
  help: string
  /** RegExp source an id must match before the page saves it. */
  pattern: string
  /** Shown when an id does not match `pattern`. */
  mismatch: string
}

/** How a delivery channel describes itself for one workspace; the capability offering the channel supplies all of it. */
export interface NotificationChannelDescription {
  /** e.g. 'Slack'. */
  label: string
  /** Who delivers for this workspace; null when the channel has no identity here, so the dispatcher passes it by. */
  sender: string | null
  /** What gives the channel an identity, shown while no channel has one. */
  setupHelp: string
  setup: { label: string, link: string }
  destinations: Record<NotificationDestinationType, NotificationDestinationHint>
}

export interface NotificationChannelInfo extends NotificationChannelDescription {
  id: string
}

export interface NotificationDeliveryResponse {
  /** In the order the dispatcher tries them; empty when no capability offers one. */
  channels: NotificationChannelInfo[]
  /** The first channel with a sender, which the next delivery goes through; null when deliveries would fail. */
  activeChannelId: string | null
}

/** The platform's notification rules validate destinations with these, so they stay here rather than with the team and bots capabilities. */
export const SLACK_CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{2,}$/
export const SLACK_MEMBER_ID_PATTERN = /^[UW][A-Z0-9]{2,}$/
