import type { AcpObject } from './sessions'
import { projectSessionPath } from './sessions'

export const DECISION_KINDS = ['permission', 'question'] as const
export type DecisionKind = (typeof DECISION_KINDS)[number]

export const DECISION_OPTION_KINDS = ['allow_once', 'allow_always', 'deny', 'answer'] as const
export type DecisionOptionKind = (typeof DECISION_OPTION_KINDS)[number]

export const DECISION_STATES = ['pending', 'answered', 'expired'] as const
export type DecisionState = (typeof DECISION_STATES)[number]

/** Where an answer came from; every surface answers the same decision and the first answer wins. */
export const DECISION_SURFACES = ['web', 'slack'] as const
export type DecisionSurface = (typeof DECISION_SURFACES)[number]

/**
 * `timeout`: nobody answered in time. `cancelled`: the turn ended or the agent withdrew the request.
 * `exited`: the agent process is gone. `refused`: the request itself was malformed or unsupported.
 */
export const DECISION_EXPIRY_REASONS = ['timeout', 'cancelled', 'exited', 'refused'] as const
export type DecisionExpiryReason = (typeof DECISION_EXPIRY_REASONS)[number]

export interface DecisionOption {
  kind: DecisionOptionKind
  /** The agent's option id; `null` for a deny the agent did not offer and for question answers. */
  optionId: string | null
  label: string
  /** The agent's own payload for the option (ACP `_meta`), e.g. the rule an always-allow would save. */
  meta: AcpObject | null
}

export interface DecisionAnswerRecord {
  optionKind: DecisionOptionKind
  optionId: string | null
  /** Question answers only: the form content sent to the agent. */
  answer: Record<string, unknown> | null
  explanation: string | null
  surface: DecisionSurface
  actorId: string
  at: string
}

export interface DecisionExpiry {
  reason: DecisionExpiryReason
  message: string
  at: string
}

export interface Decision {
  id: string
  sessionId: string
  /** The harness request this decision answers. */
  requestId: string
  kind: DecisionKind
  /** Permission only: the tool call the agent wants to run (ACP `ToolCallUpdate`). */
  toolCall: AcpObject | null
  /** Question only: the ACP form elicitation (`message`, `requestedSchema`, `_meta`). */
  request: AcpObject | null
  options: DecisionOption[]
  createdAt: string
  expiresAt: string
  state: DecisionState
  answer: DecisionAnswerRecord | null
  expiry: DecisionExpiry | null
}

/** Session log rows; they reach the SSE stream like every other row. */
export type DecisionEventPayload =
  | { kind: 'decision_opened', decision: Decision }
  | { kind: 'decision_answered', decisionId: string, answer: DecisionAnswerRecord }
  | { kind: 'decision_expired', decisionId: string, expiry: DecisionExpiry }

/**
 * Chosen by kind, never by position. `optionId` is required only when the decision offers more than one option of that kind.
 * `answer` is the form content for a question; `explanation` goes back to the agent with a deny.
 */
export interface AnswerDecisionRequest {
  optionKind: DecisionOptionKind
  optionId?: string
  answer?: Record<string, unknown>
  explanation?: string
}

export interface DecisionResponse {
  decision: Decision
}

export interface DecisionListResponse {
  decisions: Decision[]
}

export const sessionDecisionsPath = (projectSlug: string, sessionId: string) => `${projectSessionPath(projectSlug, sessionId)}/decisions`
export const sessionDecisionPath = (projectSlug: string, sessionId: string, decisionId: string) => `${sessionDecisionsPath(projectSlug, sessionId)}/${encodeURIComponent(decisionId)}`

export const DECISION_ERROR_CODES = ['invalid_request', 'not_found', 'already_answered', 'decision_expired', 'option_not_offered', 'invalid_answer'] as const
export type DecisionErrorCode = (typeof DECISION_ERROR_CODES)[number]
