export const NOTIFICATION_KINDS = ['bot.finished', 'incident.opened', 'incident.closed', 'deploy.succeeded', 'deploy.failed'] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  'bot.finished': 'A bot finishes',
  'incident.opened': 'An incident opens',
  'incident.closed': 'An incident closes',
  'deploy.succeeded': 'A deploy succeeds',
  'deploy.failed': 'A deploy fails',
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

export const projectNotificationsPath = (slug: string) => `/projects/${slug}/notifications`

/** What a `deploy.attempted` activity payload's `outcome` must be for notifications to tell success from failure. */
export const DEPLOY_OUTCOMES = ['succeeded', 'failed'] as const
export type DeployOutcome = (typeof DEPLOY_OUTCOMES)[number]
