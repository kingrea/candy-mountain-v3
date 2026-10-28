import { randomUUID } from 'node:crypto'
import { DECISION_OPTION_KINDS, DECISION_SURFACES, type AgentSessionEvent, type AnswerDecisionRequest, type Decision, type DecisionExpiryReason, type DecisionOption, type DecisionSurface } from '@candy-mountain/shared'
import type { Db } from '../db'
import type { SessionManager, SessionMessage } from '../sessions/manager'
import { DEFAULT_DECISION_TIMEOUT, resolveDecisionSettings, type DecisionSettings } from './config'
import { DecisionError } from './errors'
import { QUESTION_OPTIONS, REFUSE_PERMISSION, REFUSE_QUESTION, checkAnswer, permissionOptions, permissionResponse, questionForm } from './model'
import { findLoggedDecision, loggedDecisions } from './store'

export interface DecisionServiceDeps {
  db: Db
  sessions: SessionManager
}

export interface DecisionServiceOptions extends Partial<DecisionSettings> {
  now?: () => number
}

export interface AnswerDecisionInput extends AnswerDecisionRequest {
  surface: DecisionSurface
  actorId: string
}

export interface DecisionService {
  readonly settings: DecisionSettings
  /** Every decision of the session, oldest first; one the log left pending without a live request reads as expired. */
  list(sessionId: string): Decision[]
  get(decisionId: string): Decision | null
  /** The first valid answer wins; anything else throws `DecisionError` and leaves the decision as it was. */
  answer(decisionId: string, input: AnswerDecisionInput): Decision
  close(): void
}

interface Entry {
  decision: Decision
  timer: ReturnType<typeof setTimeout> | null
}

const EXPLANATION_MAX_LENGTH = 2000

const EXPIRY_MESSAGES: Record<DecisionExpiryReason, string> = {
  timeout: 'Nobody answered in time, so the agent was refused.',
  cancelled: 'The turn ended before anyone answered.',
  exited: 'The agent process ended before anyone answered.',
  refused: 'The request was refused.',
}

export function createDecisionService(deps: DecisionServiceDeps, options: DecisionServiceOptions = {}): DecisionService {
  const settings: DecisionSettings = { timeoutMs: options.timeoutMs ?? resolveDecisionSettings({ CM_DECISION_TIMEOUT: DEFAULT_DECISION_TIMEOUT }).timeoutMs }
  const now = options.now ?? Date.now
  const { db, sessions } = deps
  // Live sessions only: a session's entries are dropped when its process exits, the log keeps the record.
  const entries = new Map<string, Entry>()
  const byRequest = new Map<string, string>()
  const iso = () => new Date(now()).toISOString()

  function stopTimer(entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
  }

  function expire(entry: Entry, reason: DecisionExpiryReason, message = EXPIRY_MESSAGES[reason]): void {
    if (entry.decision.state !== 'pending') return
    stopTimer(entry)
    const expiry = { reason, message, at: iso() }
    entry.decision.state = 'expired'
    entry.decision.expiry = expiry
    sessions.record(entry.decision.sessionId, { kind: 'decision_expired', decisionId: entry.decision.id, expiry })
  }

  function refuse(entry: Entry, reason: DecisionExpiryReason, message?: string): void {
    const { sessionId, requestId, kind } = entry.decision
    if (kind === 'permission') sessions.respondToPermission(sessionId, requestId, REFUSE_PERMISSION)
    else sessions.respondToQuestion(sessionId, requestId, REFUSE_QUESTION)
    expire(entry, reason, message)
  }

  function open(sessionId: string, event: Extract<AgentSessionEvent, { kind: 'permission_request' | 'question' }>): void {
    const isPermission = event.kind === 'permission_request'
    const built = isPermission ? permissionOptions(event.options) : questionForm(event.request)
    const createdAt = now()
    const decision: Decision = {
      id: randomUUID(),
      sessionId,
      requestId: event.requestId,
      kind: isPermission ? 'permission' : 'question',
      toolCall: isPermission ? event.toolCall : null,
      request: isPermission ? null : event.request,
      options: built.ok ? (isPermission ? (built.value as DecisionOption[]) : QUESTION_OPTIONS) : [],
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + settings.timeoutMs).toISOString(),
      state: 'pending',
      answer: null,
      expiry: null,
    }
    const entry: Entry = { decision, timer: null }
    entries.set(decision.id, entry)
    byRequest.set(event.requestId, decision.id)
    sessions.record(sessionId, { kind: 'decision_opened', decision: structuredClone(decision) })
    if (!built.ok) {
      refuse(entry, 'refused', `Refused without asking: ${built.reason}`)
      return
    }
    entry.timer = setTimeout(() => refuse(entry, 'timeout'), settings.timeoutMs)
    entry.timer.unref()
  }

  function forget(sessionId: string): void {
    for (const [id, entry] of entries) {
      if (entry.decision.sessionId !== sessionId) continue
      expire(entry, 'exited')
      entries.delete(id)
      byRequest.delete(entry.decision.requestId)
    }
  }

  function onMessage(sessionId: string, message: SessionMessage): void {
    if (message.type !== 'event') return
    const event = message.event
    if (event.kind === 'permission_request' || event.kind === 'question') open(sessionId, event)
    else if (event.kind === 'request_cancelled') {
      const entry = entries.get(byRequest.get(event.requestId) ?? '')
      if (entry) expire(entry, 'cancelled')
    }
    else if (event.kind === 'exited') forget(sessionId)
  }

  const stopObserving = sessions.observe(onMessage)

  function lookup(decisionId: string): Decision | null {
    const entry = entries.get(decisionId)
    if (entry) return structuredClone(entry.decision)
    const logged = findLoggedDecision(db, decisionId)
    return logged ? settle(logged) : null
  }

  /** A pending row with no live request behind it is from a process that died without saying so. */
  function settle(decision: Decision): Decision {
    if (decision.state !== 'pending' || entries.has(decision.id)) return decision
    return { ...decision, state: 'expired', expiry: { reason: 'exited', message: EXPIRY_MESSAGES.exited, at: decision.expiresAt } }
  }

  function chooseOption(decision: Decision, input: AnswerDecisionInput): DecisionOption {
    if (!(DECISION_OPTION_KINDS as readonly unknown[]).includes(input.optionKind)) throw new DecisionError('invalid_request', `optionKind must be one of ${DECISION_OPTION_KINDS.join(', ')}`)
    const ofKind = decision.options.filter(option => option.kind === input.optionKind)
    if (ofKind.length === 0) {
      const reason = input.optionKind === 'allow_always' ? 'the agent proposed no rule to always allow' : `this ${decision.kind} has no ${input.optionKind} option`
      throw new DecisionError('option_not_offered', `Cannot answer ${input.optionKind}: ${reason}`)
    }
    if (input.optionId !== undefined) {
      const chosen = ofKind.find(option => option.optionId === input.optionId)
      if (!chosen) throw new DecisionError('option_not_offered', `"${input.optionId}" is not a ${input.optionKind} option of this decision`)
      return chosen
    }
    if (ofKind.length > 1) throw new DecisionError('invalid_request', `This decision offers ${ofKind.length} ${input.optionKind} options; name one by optionId`)
    return ofKind[0]!
  }

  return {
    settings,

    list(sessionId) {
      return loggedDecisions(db, sessionId).map((logged) => {
        const entry = entries.get(logged.id)
        return entry ? structuredClone(entry.decision) : settle(logged)
      })
    },

    get: lookup,

    answer(decisionId, input) {
      const entry = entries.get(decisionId)
      if (!entry) {
        const logged = lookup(decisionId)
        if (!logged) throw new DecisionError('not_found', `No decision with id "${decisionId}"`)
        if (logged.state === 'answered') throw new DecisionError('already_answered', `Already answered (${logged.answer?.optionKind}) from ${logged.answer?.surface}`)
        throw new DecisionError('decision_expired', logged.expiry?.message ?? EXPIRY_MESSAGES.exited)
      }
      const { decision } = entry
      if (decision.state === 'answered') throw new DecisionError('already_answered', `Already answered (${decision.answer?.optionKind}) from ${decision.answer?.surface}`)
      if (decision.state === 'expired') throw new DecisionError('decision_expired', decision.expiry?.message ?? EXPIRY_MESSAGES.timeout)
      if (now() >= Date.parse(decision.expiresAt)) {
        refuse(entry, 'timeout')
        throw new DecisionError('decision_expired', EXPIRY_MESSAGES.timeout)
      }
      if (!(DECISION_SURFACES as readonly unknown[]).includes(input.surface)) throw new DecisionError('invalid_request', `surface must be one of ${DECISION_SURFACES.join(', ')}`)
      if (typeof input.actorId !== 'string' || input.actorId === '') throw new DecisionError('invalid_request', 'actorId is required')

      const option = chooseOption(decision, input)
      if (input.answer !== undefined && option.kind !== 'answer') throw new DecisionError('invalid_request', 'answer is only for answering a question')
      if (input.explanation !== undefined && (option.kind !== 'deny' || decision.kind !== 'permission')) throw new DecisionError('invalid_request', 'explanation is only for denying a permission')
      if (input.explanation !== undefined && (typeof input.explanation !== 'string' || input.explanation.length > EXPLANATION_MAX_LENGTH)) throw new DecisionError('invalid_request', `explanation must be a string of at most ${EXPLANATION_MAX_LENGTH} characters`)
      const explanation = input.explanation?.trim() || null

      let content: Record<string, unknown> | null = null
      let delivered: boolean
      if (decision.kind === 'permission') {
        delivered = sessions.respondToPermission(decision.sessionId, decision.requestId, permissionResponse(option, explanation))
      }
      else if (option.kind === 'answer') {
        const checked = checkAnswer(decision.request, input.answer)
        if (!checked.ok) throw new DecisionError('invalid_answer', checked.reason)
        content = checked.value
        delivered = sessions.respondToQuestion(decision.sessionId, decision.requestId, { action: 'accept', content: content as Record<string, string | number | boolean | string[]> })
      }
      else {
        delivered = sessions.respondToQuestion(decision.sessionId, decision.requestId, { action: 'decline' })
      }
      if (!delivered) {
        expire(entry, 'cancelled')
        throw new DecisionError('decision_expired', EXPIRY_MESSAGES.cancelled)
      }

      stopTimer(entry)
      const answer = { optionKind: option.kind, optionId: option.optionId, answer: content, explanation, surface: input.surface, actorId: input.actorId, at: iso() }
      decision.state = 'answered'
      decision.answer = answer
      sessions.record(decision.sessionId, { kind: 'decision_answered', decisionId: decision.id, answer })
      return structuredClone(decision)
    },

    close() {
      stopObserving()
      for (const entry of entries.values()) stopTimer(entry)
    },
  }
}
