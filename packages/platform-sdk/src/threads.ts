import { WORKSPACES_PATH } from './workspaces'
import type { AgentSession, AgentSessionFamily } from './sessions'

/** A conversation one actor has with one chat agent in one workspace; it wraps one session at a time. */
export interface ChatThread {
  id: string
  workspaceId: string
  actorId: string
  /** A registry agent id, e.g. 'claude-code'. */
  agentId: string
  currentSessionId: string
  /** The first prompt, truncated, unless one was given; null until then. */
  title: string | null
  /** Null means the agent's own default. */
  model: string | null
  effort: string | null
  /** A turn ended since the thread was last marked read. */
  unread: boolean
  /** The current session is queued, starting or running a turn. */
  working: boolean
  lastReadAt: string | null
  lastActivityAt: string
  createdAt: string
  updatedAt: string
}

/** One session the thread has wrapped; a new one starts whenever the model or effort changes. */
export interface ChatThreadSession {
  sessionId: string
  model: string | null
  effort: string | null
  createdAt: string
}

export const CHAT_THREAD_TITLE_MAX_LENGTH = 80

export interface ChatThreadListResponse {
  /** Most recently active first. */
  threads: ChatThread[]
}

export interface ChatThreadResponse {
  thread: ChatThread
  session: AgentSession
  /** Oldest first; the last one is the current session. */
  sessions: ChatThreadSession[]
  /** On a thread of an agent a capability adds per workspace (a bot): what that capability reports for the session, in its own wire shape. */
  extension?: unknown
}

export interface ChatThreadCloseResponse extends ChatThreadResponse {
  /** False when the session kept what it held; `extension` says why. */
  released: boolean
}

export interface ChatThreadPromptResponse {
  thread: ChatThread
  session: AgentSession
}

export interface CreateChatThreadRequest {
  agentId: string
  title?: string
  model?: string | null
  effort?: string | null
  /** Marks the thread as a run of these issues, which records a run.started activity event. */
  issueIds?: string[]
}

export const chatThreadLink = (prefix: string, slug: string, threadId: string) => `/${prefix}/${slug}?thread=${encodeURIComponent(threadId)}`

/** A model or effort change starts a fresh session on the same thread. */
export interface UpdateChatThreadRequest {
  title?: string
  model?: string | null
  effort?: string | null
}

export interface ChatThreadPromptRequest {
  text: string
}

export interface ChatOption {
  value: string
  label: string
  description?: string
}

/** Empty lists mean the agent exposes no choice; the selector is then absent. */
export interface ChatAgentOptions {
  agentId: string
  family: AgentSessionFamily
  models: ChatOption[]
  efforts: ChatOption[]
}

export interface ChatAgentOptionsResponse {
  options: ChatAgentOptions
}

export const THREAD_ERROR_CODES = ['invalid_request', 'not_found', 'unsupported_agent', 'thread_busy'] as const
export type ThreadErrorCode = (typeof THREAD_ERROR_CODES)[number]

/** Without `agentId` the list covers every agent the actor may chat with. */
export function workspaceThreadsPath(workspaceSlug: string, agentId?: string): string {
  const base = `${WORKSPACES_PATH}/${encodeURIComponent(workspaceSlug)}/threads`
  return agentId ? `${base}?agent=${encodeURIComponent(agentId)}` : base
}

export const workspaceThreadPath = (workspaceSlug: string, threadId: string) => `${workspaceThreadsPath(workspaceSlug)}/${encodeURIComponent(threadId)}`
export const threadReadPath = (workspaceSlug: string, threadId: string) => `${workspaceThreadPath(workspaceSlug, threadId)}/read`
export const threadPromptPath = (workspaceSlug: string, threadId: string) => `${workspaceThreadPath(workspaceSlug, threadId)}/prompt`
export const threadCancelPath = (workspaceSlug: string, threadId: string) => `${workspaceThreadPath(workspaceSlug, threadId)}/cancel`
/** Threads of a per-workspace agent (a bot) only: cancels a running turn and releases what the session holds, as its capability allows. */
export const threadClosePath = (workspaceSlug: string, threadId: string) => `${workspaceThreadPath(workspaceSlug, threadId)}/close`
export const chatAgentOptionsPath = (workspaceSlug: string, agentId: string) => `${workspaceThreadsPath(workspaceSlug)}/agents/${encodeURIComponent(agentId)}/options`
