import type { AgentSessionEvent, BotAnswersIn, BotSessionHolder } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { BotStartError, type BotSessionService } from '../bot-sessions'
import type { Db } from '../db'
import { bots } from '../db/schema'
import type { SlackClient } from '../plugins/slack'
import { SessionError, type SessionManager } from '../sessions'
import { findTeamMemberBySlackId, mayMemberTalkToBot, touchMemberActivity } from '../team'
import { closeSlackThreadSession } from './done'
import type { SlackMessageBotEvent } from './events'
import type { SlackConnections } from './manager'
import { addSlackReaction, mentions, postToSlackThread, slackTextToPlain } from './post'
import { createSlackProgress, type SlackProgress, type SlackTurnMessage } from './progress'
import { claimSlackDelivery, countSlackThreadTurn, findSlackThread, findSlackThreadById, insertSlackThread, reopenSlackThread, slackThreadHolderId, type SlackThread, type SlackThreadRef } from './threads'
import { completeSlackTurn, countSlackTurnResume, finishSlackTurn, listOpenSlackTurns, openSlackTurn, recordSlackTurnMessage, recordSlackTurnSent, slackTurnMessage, type SlackTurn } from './turns'

export interface SlackRouterDeps {
  db: Db
  slack: Pick<SlackConnections, 'subscribe' | 'web'>
  botSessions: BotSessionService
  sessions: SessionManager
  /** Claims a thread reply before it reaches the agent, returning its work; null passes the reply on. */
  interceptReply?: SlackReplyInterceptor
}

export type SlackReplyInterceptor = (event: SlackMessageBotEvent, ref: SlackThreadRef, text: string) => Promise<void> | null

export interface SlackRouterOptions {
  fetch?: typeof fetch
  now?: () => number
  log?: Pick<Console, 'error'>
  /** Emoji name added to every message the bot takes on. */
  acknowledgeReaction?: string
  /** Shortest gap between two progress updates of one turn. */
  streamIntervalMs?: number
  /** Runs after the turn's message is final, again after a restart that cut it off, so it must be safe to repeat. */
  onTurnEnd?: SlackTurnEndHook
}

export interface SlackTurnEnd {
  thread: SlackThread
  sessionId: string
  /** The slack_turns row; null only when the prompt never reached the session log. */
  turnId: string | null
  /** The agent's text for the turn, as Slack got it. */
  text: string
  outcome: 'completed' | 'cancelled' | 'failed'
  error: string | null
  /** The message the turn streamed into; null when the turn had nothing to post. */
  message: SlackTurnMessage | null
  client: SlackClient
}

export type SlackTurnEndHook = (end: SlackTurnEnd) => Promise<void> | void

export interface SlackRouter {
  /** Resolves once every event received so far has been handled, posts included. */
  idle(): Promise<void>
  close(): void
}

/** How a Slack member's message reaches the agent; the first turn also says what the block is. */
export function slackRequestText(input: { first: boolean, from: string, memberId: string, channel: string, threadTs: string, text: string }): string {
  const tag = input.first ? 'slack-request' : 'slack-reply'
  const block = [`<${tag}>`, `from: ${input.from} (${input.memberId})`, `channel: ${input.channel}`, `thread: ${input.threadTs}`, 'message:', input.text, `</${tag}>`].join('\n')
  if (!input.first) return block
  return `A request arrived from Slack. Work it in this worktree and reply as if answering in that thread: your final message is posted there as is.\n\n${block}`
}

export const slackActorId = (slackMemberId: string) => `slack:${slackMemberId}`

/** "done" on its own, however it is dressed up, closes the thread's session. */
export const isDoneMessage = (text: string) => /^\s*[*_`~]*done[*_`~.!]*\s*$/i.test(text)

const answersIn = (scope: BotAnswersIn, channel: string) => ('anywhere' in scope ? scope.anywhere : scope.channels.includes(channel))

interface TurnOutcome {
  stopReason: string | null
  error: string | null
}

interface Follow {
  done: Promise<TurnOutcome | null>
  stop: () => void
}

/** What the agent sees when the daemon came back mid-turn. */
export const slackResumeText = () => '<slack-resume>\nThe daemon restarted while you were working on the last request. Continue from where you left off; what you say now is added to the same Slack message.\n</slack-resume>'

export const SLACK_ACKNOWLEDGE_REACTION = 'eyes'
export const SLACK_STREAM_INTERVAL_MS = 1000

export function startSlackRouter({ db, slack, botSessions, sessions, interceptReply }: SlackRouterDeps, { fetch, now = Date.now, log = console, acknowledgeReaction = SLACK_ACKNOWLEDGE_REACTION, streamIntervalMs = SLACK_STREAM_INTERVAL_MS, onTurnEnd }: SlackRouterOptions = {}): SlackRouter {
  const controller = new AbortController()
  const chains = new Map<string, Promise<void>>()
  const inFlight = new Set<Promise<void>>()
  const at = () => new Date(now()).toISOString()

  const clientFor = (botId: string): SlackClient | null => slack.web(botId, { fetch, signal: controller.signal })?.client ?? null

  async function post(botId: string, channel: string, threadTs: string, text: string): Promise<void> {
    const client = clientFor(botId)
    if (!client) return
    try {
      await postToSlackThread(client, { channel, threadTs, text })
    }
    catch (error) {
      if (!controller.signal.aborted) log.error(`Slack post to ${channel}/${threadTs} failed:`, error)
    }
  }

  async function acknowledge(event: SlackMessageBotEvent): Promise<void> {
    const client = clientFor(event.botId)
    if (!client) return
    try {
      await addSlackReaction(client, { channel: event.event.channel, ts: event.event.ts, name: acknowledgeReaction })
    }
    catch (error) {
      if (!controller.signal.aborted) log.error(`Slack reaction on ${event.event.channel}/${event.event.ts} failed:`, error)
    }
  }

  /** Runs one event's work after everything already queued for the same thread, so replies never overtake the mention. */
  function enqueue(key: string, work: () => Promise<void>): void {
    const previous = chains.get(key) ?? Promise.resolve()
    const next = previous.then(work).catch(error => log.error('Slack routing failed:', error))
    chains.set(key, next)
    inFlight.add(next)
    void next.finally(() => {
      inFlight.delete(next)
      if (chains.get(key) === next) chains.delete(key)
    })
  }

  const botRow = (botId: string) => db.select({ id: bots.id, projectId: bots.projectId, answersIn: bots.answersIn }).from(bots).where(eq(bots.id, botId)).get() ?? null

  function memberName(projectId: string, slackMemberId: string): string {
    return findTeamMemberBySlackId(db, projectId, slackMemberId)?.displayName ?? slackMemberId
  }

  /** Whether Slack accepted chat.startStream for the bot; unknown bots try it first. */
  const nativeStreaming = new Map<string, boolean>()

  function progressFor(thread: SlackThread, client: SlackClient, memberId: string, state: { turnId: string | null }, resume?: { message: SlackTurnMessage | null, openedAt: number, sentSeq: number, history: AgentSessionEvent[] }): SlackProgress {
    return createSlackProgress(client, { channel: thread.channelId, threadTs: thread.threadTs, recipientUserId: memberId, recipientTeamId: thread.teamId }, {
      intervalMs: streamIntervalMs,
      native: nativeStreaming.get(thread.botId) ?? true,
      ...resume,
      now,
      signal: controller.signal,
      log,
      onMessage(message) {
        if (message.mode === 'stream') nativeStreaming.set(thread.botId, true)
        if (state.turnId) recordSlackTurnMessage(db, state.turnId, message, at())
      },
      onSent(seq) {
        if (state.turnId) recordSlackTurnSent(db, state.turnId, seq, at())
      },
      onNativeRefused: () => nativeStreaming.set(thread.botId, false),
    })
  }

  /** Feeds the turn's log rows into its progress message until the turn ends; the prompt row is where a restart learns the turn began. */
  function follow(sessionId: string, progress: SlackProgress, onPrompt: (seq: number) => void): Follow {
    let settle: (outcome: TurnOutcome | null) => void = () => {}
    const done = new Promise<TurnOutcome | null>((resolve) => { settle = resolve })
    const unsubscribe = sessions.subscribe(sessionId, (message) => {
      if (message.type !== 'event') return
      const { event } = message
      if (event.kind === 'prompt') onPrompt(event.seq)
      else if (event.kind === 'text' || event.kind === 'tool_call' || event.kind === 'tool_result') progress.push(event)
      else if (event.kind === 'turn_end') finish({ stopReason: event.stopReason, error: null })
      else if (event.kind === 'error' && (event.phase === 'start' || event.phase === 'connection')) finish({ stopReason: null, error: event.message })
      else if (event.kind === 'auth_required') finish({ stopReason: null, error: event.message })
      else if (event.kind === 'exited' && !event.expected) finish({ stopReason: null, error: `The agent process exited unexpectedly (code ${event.code ?? 'none'})` })
    })
    const onAbort = () => finish(null)
    sessions.signal.addEventListener('abort', onAbort, { once: true })
    controller.signal.addEventListener('abort', onAbort, { once: true })
    function finish(outcome: TurnOutcome | null) {
      unsubscribe()
      sessions.signal.removeEventListener('abort', onAbort)
      controller.signal.removeEventListener('abort', onAbort)
      settle(outcome)
    }
    return { done, stop: () => finish(null) }
  }

  /** Ends the message the way the turn ended, then runs the turn-end hook; a null outcome is the daemon closing, which leaves the row for recovery. */
  async function settle(thread: SlackThread, sessionId: string, turnId: string | null, progress: SlackProgress, client: SlackClient, outcome: TurnOutcome | null): Promise<void> {
    if (!outcome) {
      progress.abandon()
      return
    }
    const cancelled = outcome.stopReason === 'cancelled'
    const note = outcome.error ? `The bot could not finish: ${outcome.error}` : cancelled && (progress.message || progress.text.trim()) ? '_Stopped._' : null
    let message: SlackTurnMessage | null
    try {
      message = await progress.finish(note)
    }
    catch (error) {
      if (!controller.signal.aborted) log.error(`Slack turn in ${thread.channelId}/${thread.threadTs} was not completed:`, error)
      return
    }
    if (turnId) finishSlackTurn(db, turnId, at())
    await end({ thread, sessionId, turnId, text: progress.text, outcome: outcome.error ? 'failed' : cancelled ? 'cancelled' : 'completed', error: outcome.error, message, client })
  }

  /** The one place a turn completes; a hook cut off by shutdown leaves the turn finished, so the next start runs it again. */
  async function end(turnEnd: SlackTurnEnd): Promise<void> {
    if (onTurnEnd) {
      try {
        await onTurnEnd(turnEnd)
      }
      catch (error) {
        if (!controller.signal.aborted) log.error('Slack turn end hook failed:', error)
      }
    }
    if (controller.signal.aborted) return
    if (turnEnd.turnId) completeSlackTurn(db, turnEnd.turnId, at())
  }

  async function startFresh(thread: SlackThread, holder: BotSessionHolder, actorId: string): Promise<string> {
    const started = await botSessions.start({ botId: thread.botId, holder, actorId, signal: controller.signal })
    reopenSlackThread(db, thread.id, started.session.id, at())
    return started.session.id
  }

  /** A worktree that went away (reclaimed, or released by "done") starts a fresh session on the same thread rather than failing the reply. */
  async function turn(thread: SlackThread, event: SlackMessageBotEvent, text: string): Promise<void> {
    const holder: BotSessionHolder = { kind: 'slack', id: slackThreadHolderId(thread) }
    const user = event.event.user!
    const actorId = slackActorId(user)
    const client = clientFor(thread.botId)
    if (!client) return
    let sessionId = thread.sessionId
    const state = { turnId: null as string | null }
    const progress = progressFor(thread, client, user, state)
    const onPrompt = (seq: number) => { state.turnId = openSlackTurn(db, { threadId: thread.id, sessionId, slackMemberId: user, promptSeq: seq, at: at() }).id }
    let following: Follow | null = null
    try {
      if (thread.state === 'closed') sessionId = await startFresh(thread, holder, actorId)
      following = follow(sessionId, progress, onPrompt)
      try {
        await botSessions.prompt(sessionId, text)
      }
      catch (error) {
        const lost = (error instanceof BotStartError && error.reason === 'worktree_released') || (error instanceof SessionError && error.code === 'not_found')
        if (!lost) throw error
        following.stop()
        sessionId = await startFresh(thread, holder, actorId)
        following = follow(sessionId, progress, onPrompt)
        await botSessions.prompt(sessionId, text)
      }
    }
    catch (error) {
      following?.stop()
      progress.abandon()
      if (controller.signal.aborted) return
      if (error instanceof BotStartError || error instanceof SessionError) {
        await post(thread.botId, thread.channelId, thread.threadTs, error.message)
        return
      }
      throw error
    }
    countSlackThreadTurn(db, thread.id, at())
    await settle(thread, sessionId, state.turnId, progress, client, await following.done)
  }

  /** A turn the previous daemon left open: resumed once into the same message, otherwise closed with what the log holds. */
  async function recover(turn: SlackTurn, thread: SlackThread): Promise<void> {
    const client = clientFor(thread.botId)
    if (!client) return
    const history = sessions.events(turn.sessionId, { after: turn.promptSeq })
    const lastPrompt = history.reduce((seq, event) => (event.kind === 'prompt' ? event.seq : seq), turn.promptSeq)
    const ended = history.find(event => event.kind === 'turn_end' && event.seq > lastPrompt)
    // The turn row is written at the prompt, before any stream opens, so its age is a safe bound on the stream's.
    const progress = progressFor(thread, client, turn.slackMemberId, { turnId: turn.id }, { message: slackTurnMessage(turn, thread), openedAt: Date.parse(turn.createdAt), sentSeq: turn.sentSeq, history })
    if (turn.state === 'finished') {
      progress.abandon()
      const outcome = ended?.kind !== 'turn_end' ? 'failed' : ended.stopReason === 'cancelled' ? 'cancelled' : 'completed'
      await end({ thread, sessionId: turn.sessionId, turnId: turn.id, text: progress.text, outcome, error: null, message: slackTurnMessage(turn, thread), client })
      return
    }
    if (ended?.kind === 'turn_end') {
      await settle(thread, turn.sessionId, turn.id, progress, client, { stopReason: ended.stopReason, error: null })
      return
    }
    if (thread.state === 'closed' || thread.sessionId !== turn.sessionId) {
      await settle(thread, turn.sessionId, turn.id, progress, client, { stopReason: 'cancelled', error: null })
      return
    }
    if (turn.resumes > 0) {
      await settle(thread, turn.sessionId, turn.id, progress, client, { stopReason: null, error: 'the daemon restarted again during this turn; reply in the thread to carry on' })
      return
    }
    countSlackTurnResume(db, turn.id, at())
    const following = follow(turn.sessionId, progress, () => {})
    try {
      await botSessions.prompt(turn.sessionId, slackResumeText())
    }
    catch (error) {
      following.stop()
      if (controller.signal.aborted) {
        progress.abandon()
        return
      }
      if (!(error instanceof BotStartError || error instanceof SessionError)) throw error
      await settle(thread, turn.sessionId, turn.id, progress, client, { stopReason: null, error: `the daemon restarted during this turn and could not resume it (${error.message})` })
      return
    }
    await settle(thread, turn.sessionId, turn.id, progress, client, await following.done)
  }

  async function mention(event: SlackMessageBotEvent, ref: SlackThreadRef): Promise<void> {
    const user = event.event.user!
    const bot = botRow(event.botId)
    if (!bot || !answersIn(bot.answersIn, ref.channelId) || !mayMemberTalkToBot(db, bot.projectId, user, bot.id)) return
    touchMemberActivity(db, bot.projectId, user, new Date(now()))
    await acknowledge(event)
    const holder: BotSessionHolder = { kind: 'slack', id: slackThreadHolderId(ref) }
    let sessionId: string
    try {
      sessionId = (await botSessions.start({ botId: bot.id, holder, actorId: slackActorId(user), signal: controller.signal })).session.id
    }
    catch (error) {
      if (controller.signal.aborted) return
      if (!(error instanceof BotStartError)) throw error
      await post(bot.id, ref.channelId, ref.threadTs, error.message)
      return
    }
    const thread = insertSlackThread(db, { ...ref, projectId: bot.projectId, teamId: event.teamId, sessionId, slackMemberId: user, at: at() })
    const text = slackRequestText({ first: true, from: memberName(bot.projectId, user), memberId: user, channel: ref.channelId, threadTs: ref.threadTs, text: slackTextToPlain(event.event.text, event.botUserId) })
    await turn(thread, event, text)
  }

  /** The replier and the member who opened the thread must both still be allowed; a closed thread only wakes on a new mention. */
  function admitted(thread: SlackThread, user: string): boolean {
    if (!mayMemberTalkToBot(db, thread.projectId, user, thread.botId)) return false
    return user === thread.slackMemberId || mayMemberTalkToBot(db, thread.projectId, thread.slackMemberId, thread.botId)
  }

  async function reply(event: SlackMessageBotEvent, ref: SlackThreadRef, mentioned: boolean): Promise<void> {
    const user = event.event.user!
    const thread = findSlackThread(db, ref)
    if (!thread || (thread.state === 'closed' && !mentioned) || !admitted(thread, user)) return
    touchMemberActivity(db, thread.projectId, user, new Date(now()))
    await acknowledge(event)
    const text = slackRequestText({ first: false, from: memberName(thread.projectId, user), memberId: user, channel: ref.channelId, threadTs: ref.threadTs, text: slackTextToPlain(event.event.text, event.botUserId) })
    await turn(thread, event, text)
  }

  async function done(event: SlackMessageBotEvent, ref: SlackThreadRef): Promise<void> {
    const user = event.event.user!
    const thread = findSlackThread(db, ref)
    if (!thread || thread.state === 'closed' || !admitted(thread, user)) return
    touchMemberActivity(db, thread.projectId, user, new Date(now()))
    const text = await closeSlackThreadSession({ db, botSessions }, thread, { at: at(), signal: controller.signal })
    if (text) await post(thread.botId, ref.channelId, ref.threadTs, text)
  }

  function handle(event: SlackMessageBotEvent): void {
    const { channel, ts, threadTs, user, text, subtype } = event.event
    if (event.fromSelf || subtype !== null || !user) return
    if (!claimSlackDelivery(db, { botId: event.botId, eventId: event.eventId, channelId: channel, ts }, at())) return
    const isReply = threadTs !== null && threadTs !== ts
    const ref: SlackThreadRef = { botId: event.botId, channelId: channel, threadTs: threadTs ?? ts }
    const mentioned = event.kind === 'app_mention' || mentions(text, event.botUserId)
    if (!isReply && !mentioned) return
    const key = slackThreadHolderId(ref)
    // A decision answer skips the queue too: the turn ahead of it is waiting on that answer.
    const intercepted = isReply ? interceptReply?.(event, ref, slackTextToPlain(text, event.botUserId)) : null
    if (intercepted) {
      const work = intercepted.catch(error => log.error('Slack routing failed:', error))
      inFlight.add(work)
      void work.finally(() => inFlight.delete(work))
      return
    }
    // "done" skips the queue so it can cancel a turn the queue is waiting on.
    if (isReply && isDoneMessage(slackTextToPlain(text, event.botUserId))) {
      const work = done(event, ref).catch(error => log.error('Slack routing failed:', error))
      inFlight.add(work)
      void work.finally(() => inFlight.delete(work))
      return
    }
    enqueue(key, () => (isReply ? reply(event, ref, mentioned) : mention(event, ref)))
  }

  // Queued before any new event so a reply to the thread waits for its interrupted turn.
  for (const turn of listOpenSlackTurns(db)) {
    const thread = findSlackThreadById(db, turn.threadId)
    if (thread) enqueue(slackThreadHolderId(thread), () => recover(turn, thread))
  }

  const unsubscribe = slack.subscribe((event) => {
    if (event.kind === 'app_mention' || event.kind === 'message') handle(event)
  }, { kinds: ['app_mention', 'message'] })

  return {
    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
    close() {
      unsubscribe()
      controller.abort()
    },
  }
}
