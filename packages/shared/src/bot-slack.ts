import { projectBotsPath } from './bots'

export const BOT_SLACK_STATES = ['connected', 'connecting', 'disconnected'] as const
export type BotSlackState = (typeof BOT_SLACK_STATES)[number]

/**
 * Why a bot is not connected. `missing_keys` is "not configured"; `inactive`, `archived` and `secrets_locked`
 * mean the daemon does not try; `invalid_token` and `error` mean it tried, failed and retries at `retryAt`.
 */
export const BOT_SLACK_REASON_CODES = ['missing_keys', 'inactive', 'archived', 'secrets_locked', 'invalid_token', 'error', 'stopped'] as const
export type BotSlackReasonCode = (typeof BOT_SLACK_REASON_CODES)[number]

/** The workspace and bot user the bot token belongs to, from Slack's auth.test. */
export interface BotSlackIdentity {
  teamId: string
  team: string
  userId: string
  user: string
}

export interface BotSlackConnection {
  state: BotSlackState
  /** Null while connected or connecting. */
  reason: string | null
  reasonCode: BotSlackReasonCode | null
  /** When `state`, `reason` or `reasonCode` last changed. */
  since: string
  retryAt: string | null
  identity: BotSlackIdentity | null
}

export interface BotSlackConnectionResponse {
  connection: BotSlackConnection
}

export const botSlackConnectionPath = (slug: string, botId: string) => `${projectBotsPath(slug)}/${botId}/slack`
