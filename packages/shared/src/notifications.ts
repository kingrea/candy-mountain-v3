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

/** What a `deploy.attempted` activity payload's `outcome` must be for notifications to tell success from failure. */
export const DEPLOY_OUTCOMES = ['succeeded', 'failed'] as const
export type DeployOutcome = (typeof DEPLOY_OUTCOMES)[number]
