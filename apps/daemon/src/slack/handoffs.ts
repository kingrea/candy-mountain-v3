import { parseHandoff, projectViewRoute, stripHandoff, type AgentSessionEvent, type Handoff } from '@candy-mountain/shared'
import { and, eq, sql } from 'drizzle-orm'
import { ActivityError, appendActivityEvent } from '../activity'
import type { BotSessionService } from '../bot-sessions'
import type { Db } from '../db'
import { activityEvents, bots, platformMeta, projects } from '../db/schema'
import type { SlackClient } from '../plugins/slack'
import type { SessionManager } from '../sessions'
import { mayMemberTalkToBot, touchMemberActivity } from '../team'
import { closeSlackThreadSession } from './done'
import type { SlackInteractiveBotEvent } from './events'
import { SLACK_HANDOFF_DONE_ACTION, slackHandoffMessage } from './handoff-message'
import type { SlackConnections } from './manager'
import { postToSlackThread } from './post'
import type { SlackTurnEnd, SlackTurnEndHook } from './router'
import { findSlackThreadById, type SlackThread } from './threads'
import { findSlackTurn, type SlackTurn } from './turns'

export interface SlackHandoffsDeps {
  db: Db
  slack: Pick<SlackConnections, 'subscribe' | 'web'>
  botSessions: Pick<BotSessionService, 'closeSession'>
  sessions: Pick<SessionManager, 'events'>
  scopeUrlPrefix: string
}

export interface SlackHandoffsOptions {
  fetch?: typeof fetch
  now?: () => number
  log?: Pick<Console, 'error'>
}

export interface SlackHandoffs {
  /** The router's turn-end hook: the card in the turn's message, then the bot.handoff activity event. */
  onTurnEnd: SlackTurnEndHook
  /** Resolves once every button press started so far has been handled. */
  idle(): Promise<void>
  close(): void
}

const TITLE_MAX = 200
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

/** Only for the card a turn without a message had to post; a message that exists is edited instead. */
const postedKey = (turnId: string) => `slack-handoff:${turnId}`

const agentText = (events: AgentSessionEvent[]) => events.map(event => (event.kind === 'text' && event.role === 'agent' ? event.text : '')).join('')

/** The text after the turn's last tool step: what the agent said when it stopped. */
function finalMessage(events: AgentSessionEvent[]): string {
  let last = ''
  for (const event of events) {
    if (event.kind === 'tool_call' || event.kind === 'tool_result') last = ''
    else if (event.kind === 'text' && event.role === 'agent') last += event.text
  }
  return last
}

/** Fence lines are skipped: a malformed handoff block must not become the headline. */
const firstLine = (text: string) => stripHandoff(text).split('\n').map(line => line.trim()).find(line => line && !/^(`{3,}|~{3,})/.test(line)) ?? null

export function startSlackHandoffs({ db, slack, botSessions, sessions, scopeUrlPrefix }: SlackHandoffsDeps, { fetch, now = Date.now, log = console }: SlackHandoffsOptions = {}): SlackHandoffs {
  const controller = new AbortController()
  const inFlight = new Set<Promise<unknown>>()
  const at = () => new Date(now()).toISOString()

  function track(work: Promise<unknown>): void {
    const settled = work.catch((error: unknown) => {
      if (!controller.signal.aborted) log.error('Slack handoff handling failed:', error)
    })
    inFlight.add(settled)
    void settled.finally(() => inFlight.delete(settled))
  }

  function clientFor(botId: string): SlackClient | null {
    try {
      return slack.web(botId, { fetch, signal: controller.signal })?.client ?? null
    }
    catch (error) {
      log.error(`No Slack client for bot ${botId}:`, error)
      return null
    }
  }

  const turnEvents = (turn: SlackTurn | null) => (turn ? sessions.events(turn.sessionId, { after: turn.promptSeq }) : [])

  /** A closed thread, or one that moved on to a new session, has nothing left for the button to close. */
  const isOpen = (thread: SlackThread | null, sessionId: string) => thread !== null && thread.state === 'open' && thread.sessionId === sessionId

  function claimPost(turnId: string): boolean {
    return db.insert(platformMeta).values({ key: postedKey(turnId), value: '1', updatedAt: at() }).onConflictDoNothing().run().changes > 0
  }

  async function showCard(end: SlackTurnEnd, handoff: Handoff): Promise<{ channel: string, ts: string } | null> {
    const { thread } = end
    const current = findSlackThreadById(db, thread.id)
    const card = slackHandoffMessage({ handoff, prose: stripHandoff(end.text), turnId: end.turnId, closed: isOpen(current, end.sessionId) ? null : { by: null } })
    try {
      if (end.message) {
        // Blocks, not just text: text alone may leave a stream's chunks in place.
        await end.client.call('chat.update', { channel: end.message.channel, ts: end.message.ts, ...card })
        return end.message
      }
      // Claimed before the post, so a rerun never posts a second card.
      if (end.turnId && !claimPost(end.turnId)) return null
      const result = await end.client.call<{ ts?: unknown }>('chat.postMessage', { channel: thread.channelId, thread_ts: thread.threadTs, ...card })
      return typeof result.ts === 'string' ? { channel: thread.channelId, ts: result.ts } : null
    }
    catch (error) {
      log.error(`Slack handoff card in ${thread.channelId}/${thread.threadTs} failed:`, error)
      return end.message
    }
  }

  async function permalink(client: SlackClient, message: { channel: string, ts: string }): Promise<string | null> {
    try {
      const result = await client.call<{ permalink?: unknown }>('chat.getPermalink', { channel: message.channel, message_ts: message.ts })
      return typeof result.permalink === 'string' ? result.permalink : null
    }
    catch (error) {
      log.error(`Slack permalink for ${message.channel}/${message.ts} failed:`, error)
      return null
    }
  }

  function recorded(projectId: string, turnId: string): boolean {
    return db.select({ id: activityEvents.id }).from(activityEvents)
      .where(and(eq(activityEvents.projectId, projectId), eq(activityEvents.type, 'bot.handoff'), sql`json_extract(${activityEvents.payload}, '$.turnId') = ${turnId}`))
      .get() !== undefined
  }

  async function record(end: SlackTurnEnd, handoff: Handoff | null, shown: { channel: string, ts: string } | null): Promise<void> {
    const { thread } = end
    if (end.turnId && recorded(thread.projectId, end.turnId)) return
    const bot = db.select({ name: bots.name }).from(bots).where(eq(bots.id, thread.botId)).get()
    const project = db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, thread.projectId)).get()
    const turn = end.turnId ? findSlackTurn(db, end.turnId) : null
    const headline = handoff?.summary ?? firstLine(finalMessage(turnEvents(turn))) ?? firstLine(end.text) ?? (end.outcome === 'failed' ? 'could not finish' : 'finished without a reply')
    const slackUrl = await permalink(end.client, shown ?? { channel: thread.channelId, ts: thread.threadTs })
    // A Slack session has no chat panel thread, so the Slack thread is the conversation to open; the bots page if Slack did not say where it is.
    const link = slackUrl ?? (project ? projectViewRoute(scopeUrlPrefix, encodeURIComponent(project.slug), 'bots') : undefined)
    try {
      appendActivityEvent(db, {
        projectId: thread.projectId,
        type: 'bot.handoff',
        title: clip(`${bot?.name ?? 'Bot'}: ${headline}`, TITLE_MAX),
        link,
        payload: {
          turnId: end.turnId,
          botId: thread.botId,
          sessionId: end.sessionId,
          slackThreadId: thread.id,
          channel: thread.channelId,
          threadTs: thread.threadTs,
          slackUrl,
          turnOutcome: end.outcome,
          outcome: handoff?.outcome ?? null,
          summary: handoff ? clip(handoff.summary, 400) : null,
          pullRequest: handoff?.pullRequest ? clip(handoff.pullRequest, 300) : null,
          issueIds: (handoff?.issues ?? []).slice(0, 20).map(id => clip(id, 64)),
          followUps: (handoff?.followUps ?? []).slice(0, 5).map(item => clip(item, 160)),
        },
      })
    }
    catch (error) {
      if (!(error instanceof ActivityError)) throw error
      log.error('Slack handoff activity event was not recorded:', error)
    }
  }

  async function onTurnEnd(end: SlackTurnEnd): Promise<void> {
    // A cancelled turn was stopped by a member ("done" or the stream's stop button), so there is nothing to hand off.
    if (end.outcome === 'cancelled') return
    const parsed = end.outcome === 'completed' ? parseHandoff(end.text) : null
    const handoff = parsed?.ok ? parsed.handoff : null
    // Without a handoff the streamed message already is the raw final text.
    const shown = handoff ? await showCard(end, handoff) : end.message
    await record(end, handoff, shown)
  }

  /** The replier and the member who opened the thread must both still be allowed, as for a "done" reply. */
  function admitted(thread: SlackThread, user: string): boolean {
    if (!mayMemberTalkToBot(db, thread.projectId, user, thread.botId)) return false
    return user === thread.slackMemberId || mayMemberTalkToBot(db, thread.projectId, thread.slackMemberId, thread.botId)
  }

  async function markDone(event: SlackInteractiveBotEvent, turnId: string, user: string): Promise<void> {
    const { channelId, messageTs } = event.interaction
    const turn = findSlackTurn(db, turnId)
    const thread = turn ? findSlackThreadById(db, turn.threadId) : null
    if (!turn || !thread || thread.botId !== event.botId || (channelId !== null && channelId !== thread.channelId) || !admitted(thread, user)) return
    const client = clientFor(thread.botId)
    if (!client) return
    let by: string | null = null
    // The thread is closed before the first await, so a double press or a redelivered envelope closes it once.
    if (isOpen(thread, turn.sessionId)) {
      touchMemberActivity(db, thread.projectId, user, new Date(now()))
      by = user
      const reply = await closeSlackThreadSession({ db, botSessions }, thread, { at: at(), signal: controller.signal })
      if (!reply) return
      await postToSlackThread(client, { channel: thread.channelId, threadTs: thread.threadTs, text: reply })
    }
    const text = agentText(turnEvents(turn))
    const parsed = parseHandoff(text)
    if (!parsed.ok || !messageTs) return
    const card = slackHandoffMessage({ handoff: parsed.handoff, prose: stripHandoff(text), turnId, closed: { by } })
    await client.call('chat.update', { channel: thread.channelId, ts: messageTs, ...card })
  }

  function onInteraction(event: SlackInteractiveBotEvent): void {
    const { interaction } = event
    if (interaction.type !== 'block_actions' || !interaction.userId) return
    for (const action of interaction.actions) {
      if (action.actionId !== SLACK_HANDOFF_DONE_ACTION || !action.value) continue
      track(markDone(event, action.value, interaction.userId))
    }
  }

  const unsubscribe = slack.subscribe((event) => {
    if (event.kind === 'interactive') onInteraction(event)
  }, { kinds: ['interactive'] })

  return {
    onTurnEnd,
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
    close() {
      unsubscribe()
      controller.abort()
    },
  }
}
