import type { SlackClient } from '../plugins/slack'

/** Slack renders a message of at most 4,000 characters; longer text goes out as several replies. */
export const SLACK_TEXT_MAX = 3_900

export function splitSlackText(text: string, max = SLACK_TEXT_MAX): string[] {
  const parts: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const cut = rest.lastIndexOf('\n', max)
    const at = cut > max / 2 ? cut : max
    parts.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest) parts.push(rest)
  return parts
}

export interface SlackThreadPost {
  channel: string
  threadTs: string
  text: string
}

export async function postToSlackThread(client: SlackClient, { channel, threadTs, text }: SlackThreadPost): Promise<string[]> {
  const posted: string[] = []
  for (const part of splitSlackText(text)) {
    const result = await client.call<{ ts?: unknown }>('chat.postMessage', { channel, thread_ts: threadTs, text: part })
    if (typeof result.ts === 'string') posted.push(result.ts)
  }
  return posted
}

export function addSlackReaction(client: SlackClient, { channel, ts, name }: { channel: string, ts: string, name: string }): Promise<unknown> {
  return client.call('reactions.add', { channel, timestamp: ts, name })
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' }

/** Slack's mrkdwn as the agent should read it: the bot's own mention gone, links unwrapped, entities decoded. */
export function slackTextToPlain(text: string, botUserId: string | null): string {
  let plain = botUserId ? text.split(`<@${botUserId}>`).join('') : text
  plain = plain.replace(/<(https?:\/\/[^|>]+)\|([^>]*)>/g, '$2 ($1)').replace(/<(https?:\/\/[^>]+)>/g, '$1')
  return plain.replace(/&(amp|lt|gt);/g, match => ENTITIES[match] ?? match).trim()
}

export function mentions(text: string, botUserId: string | null): boolean {
  return botUserId !== null && text.includes(`<@${botUserId}>`)
}
