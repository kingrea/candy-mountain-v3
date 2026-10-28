import type { BotSessionHolder } from './bot-sessions'
import type { DecisionEventPayload } from './decisions'
import type { PlatformClientAction } from './platform-agent'
import { PROJECTS_PATH } from './projects'

/** `platform` runs in-process on Mastra; the other two are ACP processes. */
export const AGENT_SESSION_FAMILIES = ['claude-code', 'codex', 'platform'] as const
export type AgentSessionFamily = (typeof AGENT_SESSION_FAMILIES)[number]

export const AGENT_SESSION_FAMILY_NAMES: Record<AgentSessionFamily, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'platform': 'Platform agent',
}

/**
 * `idle`: no live process (never started, reaped or exited); the next prompt resumes it.
 * `queued`: a prompt is waiting for a live slot. `starting`: the process is being launched.
 * `live`: the process is up and waiting. `prompting`: a turn is running.
 */
export const AGENT_SESSION_STATUSES = ['idle', 'queued', 'starting', 'live', 'prompting'] as const
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number]

export const CODEX_SESSION_MODES = ['read-only', 'workspace-write'] as const
export type CodexSessionMode = (typeof CODEX_SESSION_MODES)[number]

/** Launch posture, fixed when the session is created and reused on every resume. */
export interface AgentSessionPosture {
  /** Claude Code only: flags forwarded verbatim to the CLI. */
  flags?: string[]
  /** Codex only. */
  codex?: {
    mode?: CodexSessionMode
    developerInstructions?: string
    /** A model id the adapter listed; absent means the Codex default. */
    model?: string
    reasoningEffort?: string
    /** Bot sessions only: absolute directories the sandbox may also write; never settable over REST. */
    writableRoots?: string[]
  }
  /** Extra child variables the session was created with, reused on every resume; never settable over REST. */
  env?: Record<string, string>
  /** Set on bot sessions: the bot that runs it and the thread that holds it. */
  bot?: {
    id: string
    name: string
    holder: BotSessionHolder
  }
}

export interface AgentSession {
  id: string
  projectId: string
  family: AgentSessionFamily
  actorId: string
  cwd: string
  /** The agent's own session id once the first live process started; what resumes the conversation. */
  upstreamSessionId: string | null
  status: AgentSessionStatus
  posture: AgentSessionPosture | null
  createdAt: string
  lastActivityAt: string
}

export const PERMISSION_OPTION_KINDS = ['allow_once', 'allow_always', 'reject_once', 'reject_always'] as const
export type PermissionOptionKind = (typeof PERMISSION_OPTION_KINDS)[number]

export interface SessionPermissionOption {
  optionId: string
  name: string
  kind: PermissionOptionKind
}

/** ACP structures are carried verbatim; the daemon's ACP types are the source of their shape. */
export type AcpObject = Record<string, unknown>

export type AgentSessionEventPayload =
  | { kind: 'prompt', text: string }
  | { kind: 'text', role: 'agent' | 'user', text: string }
  | { kind: 'reasoning', text: string }
  | { kind: 'tool_call', toolCall: AcpObject }
  | { kind: 'tool_result', update: AcpObject }
  | { kind: 'usage', usage: AcpObject }
  | { kind: 'other', update: AcpObject }
  | { kind: 'permission_request', requestId: string, toolCall: AcpObject, options: SessionPermissionOption[] }
  | { kind: 'question', requestId: string, request: AcpObject }
  | { kind: 'request_cancelled', requestId: string }
  | { kind: 'turn_end', stopReason: string, usage: AcpObject | null }
  | { kind: 'error', phase: 'prompt' | 'cancel' | 'connection' | 'start', message: string, code: number | null }
  | { kind: 'auth_required', message: string }
  | { kind: 'exited', code: number | null, signal: string | null, expected: boolean }
  | { kind: 'client_action', toolCallId: string, action: PlatformClientAction }
  | DecisionEventPayload

export type AgentSessionEventKind = AgentSessionEventPayload['kind']

/** One row of a session's log: `seq` starts at 1 per session and only ever grows, across resumes and restarts. */
export type AgentSessionEvent = { seq: number, at: string } & AgentSessionEventPayload

export interface CreateSessionRequest {
  family: AgentSessionFamily
  posture?: AgentSessionPosture
}

export interface SessionPromptRequest {
  text: string
}

export const SESSION_PROMPT_MAX_LENGTH = 200_000

export interface SessionResponse {
  session: AgentSession
}

export interface SessionListResponse {
  sessions: AgentSession[]
}

export function projectSessionsPath(projectSlug: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(projectSlug)}/sessions`
}

export function projectSessionPath(projectSlug: string, sessionId: string): string {
  return `${projectSessionsPath(projectSlug)}/${encodeURIComponent(sessionId)}`
}

export const sessionPromptPath = (projectSlug: string, sessionId: string) => `${projectSessionPath(projectSlug, sessionId)}/prompt`
export const sessionCancelPath = (projectSlug: string, sessionId: string) => `${projectSessionPath(projectSlug, sessionId)}/cancel`

/** SSE stream: replays the log after `after` (default 0), then follows live. */
export function sessionEventsPath(projectSlug: string, sessionId: string, after?: number): string {
  const base = `${projectSessionPath(projectSlug, sessionId)}/events`
  return after ? `${base}?after=${after}` : base
}

/** SSE event names on the stream: a log row (data: AgentSessionEvent, id: seq) and a status change (data: SessionStatusEvent). */
export const SESSION_EVENT_NAME = 'session'
export const SESSION_STATUS_EVENT_NAME = 'status'

export interface SessionStatusEvent {
  status: AgentSessionStatus
}

export const SESSION_ERROR_CODES = ['invalid_request', 'not_found', 'session_busy', 'family_unavailable', 'auth_required', 'agent_failed'] as const
export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number]
