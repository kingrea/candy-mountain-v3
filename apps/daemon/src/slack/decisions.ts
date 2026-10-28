import type { AnswerDecisionRequest, Decision } from '@candy-mountain/shared'
import { eq, like } from 'drizzle-orm'
import type { Db } from '../db'
import { platformMeta } from '../db/schema'
import { DecisionError, type DecisionService } from '../decisions'
import type { SlackClient } from '../plugins/slack'
import type { SessionManager, SessionMessage } from '../sessions'
import { mayMemberTalkToBot, touchMemberActivity } from '../team'
import { SLACK_DECISION_ACTION, parseSlackDecisionReply, slackAnswerFromText, slackDecisionChoices, slackDecisionMessage, slackDecisionShortId, type Parsed, type SlackDecisionReply } from './decision-message'
import type { SlackInteractiveBotEvent, SlackMessageBotEvent } from './events'
import type { SlackConnections } from './manager'
import { addSlackReaction, postToSlackThread } from './post'
import { slackActorId, type SlackReplyInterceptor } from './router'
import { findSlackThread, findSlackThreadBySession, type SlackThread, type SlackThreadRef } from './threads'

export interface SlackDecisionsDeps {
  db: Db
  slack: Pick<SlackConnections, 'subscribe' | 'web'>
  decisions: Pick<DecisionService, 'answer' | 'get' | 'list'>
  sessions: Pick<SessionManager, 'observe'>
}

export interface SlackDecisionsOptions {
  fetch?: typeof fetch
  now?: () => number
  log?: Pick<Console, 'error'>
  /** Emoji name added to a text reply that answered a decision. */
  answeredReaction?: string
}

export interface SlackDecisions {
  /** Hand to the router so `yes <id>` and friends answer instead of prompting the agent. */
  interceptReply: SlackReplyInterceptor
  /** Resolves once every post, update and answer started so far has finished. */
  idle(): Promise<void>
  close(): void
}

interface PostedMessage {
  botId: string
  channel: string
  ts: string
}

/** Survives a restart so a message whose decision died with the daemon still gets its outcome. */
const META_PREFIX = 'slack-decision:'
const metaKey = (decisionId: string) => `${META_PREFIX}${decisionId}`

export const SLACK_ANSWERED_REACTION = 'white_check_mark'

export function startSlackDecisions({ db, slack, decisions, sessions }: SlackDecisionsDeps, { fetch, now = Date.now, log = console, answeredReaction = SLACK_ANSWERED_REACTION }: SlackDecisionsOptions = {}): SlackDecisions {
  const controller = new AbortController()
  const messages = new Map<string, Promise<PostedMessage | null>>()
  const inFlight = new Set<Promise<unknown>>()

  function track<T>(work: Promise<T>): Promise<T> {
    const settled = work.catch((error: unknown) => {
      if (!controller.signal.aborted) log.error('Slack decision handling failed:', error)
      return null
    })
    inFlight.add(settled)
    void settled.finally(() => inFlight.delete(settled))
    return work
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

  function remember(decisionId: string, posted: PostedMessage): void {
    const value = JSON.stringify(posted)
    const updatedAt = new Date(now()).toISOString()
    db.insert(platformMeta).values({ key: metaKey(decisionId), value, updatedAt }).onConflictDoUpdate({ target: platformMeta.key, set: { value, updatedAt } }).run()
  }

  const forget = (decisionId: string) => void db.delete(platformMeta).where(eq(platformMeta.key, metaKey(decisionId))).run()

  async function post(thread: SlackThread, decision: Decision): Promise<PostedMessage | null> {
    const client = clientFor(thread.botId)
    if (!client) return null
    const message = slackDecisionMessage(decision)
    const result = await client.call<{ ts?: unknown, channel?: unknown }>('chat.postMessage', { channel: thread.channelId, thread_ts: thread.threadTs, ...message })
    if (typeof result.ts !== 'string') return null
    const posted = { botId: thread.botId, channel: thread.channelId, ts: result.ts }
    remember(decision.id, posted)
    return posted
  }

  /** Shows whatever the decision is now; a pending one keeps its buttons. */
  async function render(posted: PostedMessage, decisionId: string): Promise<void> {
    const decision = decisions.get(decisionId)
    const client = clientFor(posted.botId)
    if (!decision || !client) return
    await client.call('chat.update', { channel: posted.channel, ts: posted.ts, ...slackDecisionMessage(decision) })
    if (decision.state !== 'pending') forget(decisionId)
  }

  function opened(sessionId: string, decision: Decision): void {
    const thread = findSlackThreadBySession(db, sessionId)
    if (!thread || thread.state === 'closed') return
    messages.set(decision.id, track(post(thread, decision)).catch(() => null))
  }

  function settled(decisionId: string): void {
    const posted = messages.get(decisionId)
    if (!posted) return
    messages.delete(decisionId)
    void track(posted.then(message => (message ? render(message, decisionId) : undefined)))
  }

  function onMessage(sessionId: string, message: SessionMessage): void {
    if (message.type !== 'event') return
    const { event } = message
    if (event.kind === 'decision_opened') opened(sessionId, event.decision)
    else if (event.kind === 'decision_answered' || event.kind === 'decision_expired') settled(event.decisionId)
  }

  /** The member answering and the member who opened the thread must both still be allowed, as for any reply. */
  function mayAnswer(thread: SlackThread, user: string): boolean {
    if (!mayMemberTalkToBot(db, thread.projectId, user, thread.botId)) return false
    return user === thread.slackMemberId || mayMemberTalkToBot(db, thread.projectId, thread.slackMemberId, thread.botId)
  }

  function answer(thread: SlackThread, decisionId: string, user: string, request: AnswerDecisionRequest): Parsed<Decision> {
    try {
      const decision = decisions.answer(decisionId, { ...request, surface: 'slack', actorId: slackActorId(user) })
      touchMemberActivity(db, thread.projectId, user, new Date(now()))
      return { ok: true, value: decision }
    }
    catch (error) {
      if (error instanceof DecisionError) return { ok: false, reason: error.message }
      throw error
    }
  }

  function onInteraction(event: SlackInteractiveBotEvent): void {
    const { interaction } = event
    if (interaction.type !== 'block_actions' || !interaction.userId) return
    for (const action of interaction.actions) {
      if (!action.actionId.startsWith(`${SLACK_DECISION_ACTION}:`) || !action.value) continue
      const [decisionId = '', number = ''] = action.value.split(':')
      const decision = decisions.get(decisionId)
      const thread = decision ? findSlackThreadBySession(db, decision.sessionId) : null
      if (!decision || !thread || thread.botId !== event.botId || !mayAnswer(thread, interaction.userId)) continue
      const choice = slackDecisionChoices(decision)[Number(number) - 1]
      const result = choice ? answer(thread, decisionId, interaction.userId, choice.request) : null
      // A press on a message that is already settled, or that outlived a restart, gets the current outcome instead.
      if (!result?.ok && interaction.channelId && interaction.messageTs) {
        void track(render({ botId: event.botId, channel: interaction.channelId, ts: interaction.messageTs }, decisionId))
      }
    }
  }

  function resolve(reply: SlackDecisionReply, sessionId: string): { decision: Decision, words: string[] } | null {
    const byShort = new Map<string, Decision>()
    // Later decisions overwrite earlier ones, so a short id clash resolves to the newest.
    for (const decision of decisions.list(sessionId)) byShort.set(slackDecisionShortId(decision.id), decision)
    const [first = '', second = ''] = reply.words
    const direct = byShort.get(first.toLowerCase())
    if (direct) return { decision: direct, words: reply.words.slice(1) }
    // "choose 2 ab12cd" reads as naturally as "choose ab12cd 2".
    const swapped = reply.verb === 'choose' ? byShort.get(second.toLowerCase()) : undefined
    return swapped ? { decision: swapped, words: [first, ...reply.words.slice(2)] } : null
  }

  function requestFor(reply: SlackDecisionReply, decision: Decision, words: string[]): Parsed<AnswerDecisionRequest> {
    const short = slackDecisionShortId(decision.id)
    // The first option of a kind, named, so a decision offering two of that kind still has an answer.
    const firstOf = (kind: 'allow_once' | 'deny'): AnswerDecisionRequest => {
      const optionId = decision.options.find(option => option.kind === kind)?.optionId
      return { optionKind: kind, ...(optionId ? { optionId } : {}) }
    }
    switch (reply.verb) {
      case 'yes':
        return decision.kind === 'permission'
          ? { ok: true, value: firstOf('allow_once') }
          : { ok: false, reason: `\`${short}\` is a question: reply \`answer ${short} <text>\` or \`choose ${short} <number>\`.` }
      case 'no': {
        const reason = decision.kind === 'permission' ? reply.rest : ''
        return { ok: true, value: { ...firstOf('deny'), ...(reason ? { explanation: reason } : {}) } }
      }
      case 'choose': {
        const choices = slackDecisionChoices(decision)
        const number = Number(words[0])
        const choice = Number.isInteger(number) ? choices[number - 1] : undefined
        return choice ? { ok: true, value: choice.request } : { ok: false, reason: `Pick a number from 1 to ${choices.length} for \`${short}\`.` }
      }
      case 'answer': {
        if (decision.kind !== 'question') return { ok: false, reason: `\`${short}\` asks for permission: reply \`yes ${short}\` or \`no ${short}\`.` }
        const parsed = slackAnswerFromText(decision, reply.rest)
        return parsed.ok ? { ok: true, value: { optionKind: 'answer', answer: parsed.value } } : parsed
      }
    }
  }

  async function reportReply(thread: SlackThread, event: SlackMessageBotEvent, result: Parsed<Decision>): Promise<void> {
    const client = clientFor(thread.botId)
    if (!client) return
    if (result.ok) await addSlackReaction(client, { channel: event.event.channel, ts: event.event.ts, name: answeredReaction })
    else await postToSlackThread(client, { channel: thread.channelId, threadTs: thread.threadTs, text: result.reason })
  }

  const interceptReply: SlackReplyInterceptor = (event, ref: SlackThreadRef, text) => {
    const reply = parseSlackDecisionReply(text)
    const user = event.event.user
    if (!reply || !user) return null
    const thread = findSlackThread(db, ref)
    if (!thread || thread.state === 'closed' || !mayAnswer(thread, user)) return null
    const found = resolve(reply, thread.sessionId)
    if (!found) return null
    const { decision, words } = found
    const request = requestFor(reply, decision, words)
    const result = request.ok ? answer(thread, decision.id, user, request.value) : request
    const short = slackDecisionShortId(decision.id)
    return reportReply(thread, event, result.ok ? result : { ok: false, reason: `Could not answer \`${short}\`: ${result.reason}` })
  }

  const stopObserving = sessions.observe(onMessage)
  const unsubscribe = slack.subscribe((event) => {
    if (event.kind === 'interactive') onInteraction(event)
  }, { kinds: ['interactive'] })

  function recover(): void {
    const rows = db.select().from(platformMeta).where(like(platformMeta.key, `${META_PREFIX}%`)).all()
    for (const row of rows) {
      const decisionId = row.key.slice(META_PREFIX.length)
      let posted: PostedMessage
      try {
        posted = JSON.parse(row.value) as PostedMessage
      }
      catch {
        forget(decisionId)
        continue
      }
      const decision = decisions.get(decisionId)
      if (!decision) {
        forget(decisionId)
        continue
      }
      if (decision.state === 'pending') messages.set(decisionId, Promise.resolve(posted))
      else void track(render(posted, decisionId))
    }
  }
  recover()

  return {
    interceptReply,
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
    close() {
      stopObserving()
      unsubscribe()
      controller.abort()
    },
  }
}
