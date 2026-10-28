import type { Handoff, HandoffOutcome } from '@candy-mountain/shared'
import { escapeSlackText } from './decision-message'

/** The "mark done" button; its value is the slack_turns id of the turn the card ended. */
export const SLACK_HANDOFF_DONE_ACTION = 'cm-handoff:done'

// Slack caps markdown blocks at 12,000 characters per message.
const PROSE_MAX = 11_000
const SECTION_MAX = 3_000
const FALLBACK_MAX = 3_000

const OUTCOME_LABEL: Record<HandoffOutcome, string> = { done: 'Done', partial: 'Partly done', blocked: 'Blocked' }
const OUTCOME_EMOJI: Record<HandoffOutcome, string> = { done: ':white_check_mark:', partial: ':large_yellow_circle:', blocked: ':no_entry:' }

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/** The id as the issues list shows it: what follows the project prefix, upper-cased. */
export function issueShortId(id: string): string {
  const short = id.slice(id.lastIndexOf('-') + 1)
  return short ? short.toUpperCase() : id
}

function pullRequestLink(value: string): string {
  if (!/^https?:\/\/[^\s|<>]+$/.test(value)) return escapeSlackText(value)
  const number = /\/pull(?:s|-requests)?\/(\d+)/.exec(value)?.[1] ?? /\/merge_requests\/(\d+)/.exec(value)?.[1]
  return `<${value}|${number ? `#${number}` : escapeSlackText(value)}>`
}

export interface SlackHandoffCard {
  handoff: Handoff
  /** The agent's message without its handoff block. */
  prose: string
  /** Null hides the button: a turn without a slack_turns row has nothing to point it at. */
  turnId: string | null
  /** Set once the session is closed; `by` is the member who pressed the button, when it was the button. */
  closed: { by: string | null } | null
}

export function slackHandoffMessage({ handoff, prose, turnId, closed }: SlackHandoffCard): { text: string, blocks: Record<string, unknown>[] } {
  const blocks: Record<string, unknown>[] = []
  const body = prose.trim()
  if (body) blocks.push({ type: 'markdown', text: clip(body, PROSE_MAX) }, { type: 'divider' })
  const label = OUTCOME_LABEL[handoff.outcome]
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(`${OUTCOME_EMOJI[handoff.outcome]} *${label}*\n${escapeSlackText(handoff.summary)}`, SECTION_MAX) } })
  const fields: Record<string, unknown>[] = []
  if (handoff.pullRequest) fields.push({ type: 'mrkdwn', text: clip(`*Pull request*\n${pullRequestLink(handoff.pullRequest)}`, 2_000) })
  if (handoff.issues.length) fields.push({ type: 'mrkdwn', text: clip(`*Issues*\n${handoff.issues.map(id => `\`${escapeSlackText(issueShortId(id))}\``).join(', ')}`, 2_000) })
  if (fields.length) blocks.push({ type: 'section', fields })
  if (handoff.followUps.length) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(`*Follow-ups*\n${handoff.followUps.map(item => `• ${escapeSlackText(item)}`).join('\n')}`, SECTION_MAX) } })
  if (closed) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: closed.by ? `Marked done by <@${closed.by}>.` : 'The session is closed.' }] })
  }
  else if (turnId) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        action_id: SLACK_HANDOFF_DONE_ACTION,
        text: { type: 'plain_text', text: 'Mark done' },
        style: 'primary',
        value: turnId,
        confirm: {
          title: { type: 'plain_text', text: 'Close this session?' },
          text: { type: 'mrkdwn', text: 'Same as replying *done*: the bot stops answering here, and its worktree is released if the work is on origin.' },
          confirm: { type: 'plain_text', text: 'Mark done' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      }],
    })
  }
  return { text: clip(`${label}: ${escapeSlackText(handoff.summary)}`, FALLBACK_MAX), blocks }
}
