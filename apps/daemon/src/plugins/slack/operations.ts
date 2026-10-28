import type { PluginSecrets } from '@candy-mountain/shared'
import type { SlackConfig } from '../types/slack'
import { createSlackClient, type SlackClientOptions } from './client'

/** One Block Kit block; the shape is Slack's to validate. */
export type SlackBlock = Readonly<Record<string, unknown>>

/** A channel id, a member id to direct-message, or neither for the configured default channel. */
export type SlackDestination =
  | { channel: string, memberId?: undefined }
  | { memberId: string, channel?: undefined }
  | { channel?: undefined, memberId?: undefined }

/** Needs text, blocks or both; with blocks, text is the notification fallback. */
export type SlackMessage = SlackDestination & { text?: string, blocks?: readonly SlackBlock[] }

export interface SlackPostedMessage {
  /** The conversation it landed in: the DM channel id when sent to a member. */
  channel: string
  ts: string
}

export interface SlackIdentity {
  teamId: string
  team: string
  userId: string
  user: string
  url: string
}

export interface SlackOperations {
  authTest(): Promise<SlackIdentity>
  /** Returns the DM channel id for a member, opening the conversation if needed. */
  openDirectMessage(memberId: string): Promise<string>
  postMessage(message: SlackMessage): Promise<SlackPostedMessage>
}

export const SLACK_MAX_BLOCKS = 50
const MEMBER_ID = /^[UW][A-Z0-9]+$/

/** Never throws itself; each operation throws SlackApiError with the token redacted. */
export function createSlackOperations(config: SlackConfig, secrets: PluginSecrets<'botToken'>, options: SlackClientOptions = {}): SlackOperations {
  const client = createSlackClient(secrets.get('botToken'), options)
  const invalid = (method: string, message: string) => client.error(method, 'invalid_request', message)

  async function openDirectMessage(memberId: string): Promise<string> {
    if (!MEMBER_ID.test(memberId)) throw invalid('conversations.open', `'${memberId}' is not a Slack member id.`)
    const result = await client.call<{ channel?: { id?: unknown } }>('conversations.open', { users: memberId })
    if (typeof result.channel?.id !== 'string') throw client.error('conversations.open', 'invalid_response', 'Slack sent no conversation for the direct message.')
    return result.channel.id
  }

  return Object.freeze({
    async authTest() {
      const result = await client.call<Record<string, unknown>>('auth.test')
      const field = (name: string) => (typeof result[name] === 'string' ? result[name] : '')
      if (!field('team_id') || !field('user_id')) throw client.error('auth.test', 'invalid_response', 'Slack sent no identity for the bot token.')
      return { teamId: field('team_id'), team: field('team') || field('team_id'), userId: field('user_id'), user: field('user') || field('user_id'), url: field('url') }
    },

    openDirectMessage,

    async postMessage(message: SlackMessage) {
      const method = 'chat.postMessage'
      const text = message.text?.trim() ? message.text : undefined
      const { blocks } = message
      if (blocks !== undefined) {
        if (!Array.isArray(blocks)) throw invalid(method, 'Blocks must be an array.')
        if (blocks.length > SLACK_MAX_BLOCKS) throw invalid(method, `A message can have at most ${SLACK_MAX_BLOCKS} blocks.`)
        if (blocks.some(b => b === null || typeof b !== 'object' || Array.isArray(b) || typeof b.type !== 'string')) throw invalid(method, 'Every block needs a type.')
      }
      if (!text && !blocks?.length) throw invalid(method, 'A message needs text or blocks.')
      if (message.channel !== undefined && message.memberId !== undefined) throw invalid(method, 'Give a channel or a member, not both.')

      let channel = message.channel?.trim() || undefined
      if (message.memberId !== undefined) channel = await openDirectMessage(message.memberId.trim())
      else if (message.channel === undefined) channel = config.defaultChannelId
      if (!channel) throw invalid(method, 'No channel or member was given and no default channel is configured.')

      const result = await client.call<{ channel?: unknown, ts?: unknown }>(method, {
        channel,
        ...(text === undefined ? {} : { text }),
        ...(blocks?.length ? { blocks } : {}),
      })
      if (typeof result.ts !== 'string') throw client.error(method, 'invalid_response', 'Slack sent no timestamp for the posted message.')
      return { channel: typeof result.channel === 'string' ? result.channel : channel, ts: result.ts }
    },
  })
}
