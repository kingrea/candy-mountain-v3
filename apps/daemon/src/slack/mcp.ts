import type { AgentSession } from '@candy-mountain/shared'
import type { AgentMcpServerDefinition } from '../agent-mcp/host'
import { SLACK_POST_BLOCKS_TOOL } from '../agent-mcp/tools'
import type { Db } from '../db'
import { SLACK_MAX_BLOCKS, SlackApiError } from '../plugins/slack'
import { SLACK_FALLBACK_TEXT_MAX, validateSlackBlocksPost } from './block-kit'
import type { SlackConnections } from './manager'
import { findSlackThreadBySession, slackThreadHolderId } from './threads'

export interface SlackMcpDeps {
  db: Db
  slack: Pick<SlackConnections, 'web'>
}

export interface SlackMcpOptions {
  fetch?: typeof fetch
}

const isSlackBotSession = (session: AgentSession) => session.posture?.bot?.holder.kind === 'slack'

/** The thread is read from the mapping row, never from the agent, so a session can only reach the thread it was started for. */
export function slackMcpServer({ db, slack }: SlackMcpDeps, { fetch }: SlackMcpOptions = {}): AgentMcpServerDefinition {
  return {
    name: SLACK_POST_BLOCKS_TOOL.server,
    appliesTo: isSlackBotSession,
    tools: [{
      name: SLACK_POST_BLOCKS_TOOL.tool,
      title: 'Post Block Kit to this Slack thread',
      description: `Posts a Slack Block Kit message to the Slack thread you are answering, and only that thread. Use it for formatted output (sections, headers, fields, context, dividers, link buttons); your final plain-text reply is still posted as usual. Give "text" as the fallback shown in notifications (at most ${SLACK_FALLBACK_TEXT_MAX} characters) and "blocks" as 1 to ${SLACK_MAX_BLOCKS} Block Kit blocks of type section, header, divider, context, actions, image, markdown or rich_text. Other channels or threads, @channel/@here mentions, action ids starting with "cm-" and anything resembling a credential are refused.`,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Fallback text for notifications and screen readers.' },
          blocks: { type: 'array', items: { type: 'object' }, minItems: 1, maxItems: SLACK_MAX_BLOCKS, description: 'Block Kit blocks.' },
          channel: { type: 'string', description: 'Optional; must be the current thread\'s channel.' },
          thread_ts: { type: 'string', description: 'Optional; must be the current thread.' },
        },
        required: ['text', 'blocks'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      async call(args, { session, signal }) {
        const thread = findSlackThreadBySession(db, session.id)
        const bot = session.posture?.bot
        if (!thread || thread.state !== 'open' || !bot || bot.id !== thread.botId || bot.holder.id !== slackThreadHolderId(thread)) {
          return { text: 'This session is not answering an open Slack thread, so nothing was posted.', isError: true }
        }
        const checked = validateSlackBlocksPost(args, { channel: thread.channelId, threadTs: thread.threadTs })
        if (!checked.ok) return { text: `Refused: ${checked.reason}. Nothing was posted.`, isError: true }
        const client = slack.web(thread.botId, { fetch, signal })?.client
        if (!client) return { text: 'The bot has no Slack bot token, so nothing was posted.', isError: true }
        try {
          const result = await client.call<{ ts?: unknown }>('chat.postMessage', { ...checked.post })
          return { text: `Posted to the Slack thread${typeof result.ts === 'string' ? ` (message ts ${result.ts})` : ''}.` }
        }
        catch (error) {
          if (error instanceof SlackApiError) return { text: `Slack refused the post: ${error.message}`, isError: true }
          throw error
        }
      },
    }],
  }
}
