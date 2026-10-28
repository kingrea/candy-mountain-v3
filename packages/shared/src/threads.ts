import { PROJECTS_PATH } from './projects'
import type { AgentSession, AgentSessionFamily } from './sessions'

/** A conversation one actor has with one chat agent in one project; it wraps one session at a time. */
export interface ChatThread {
  id: string
  projectId: string
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
  /** Present on a bot thread only. */
  bot?: ChatThreadBot
}

/** Where a bot thread's current session works. */
export interface ChatThreadBot {
  botId: string
  name: string
  /** Null when the session never got a worktree. */
  worktreePath: string | null
  branch: string | null
  baseBranch: string | null
  /** 'released' after a close reclaimed the worktree; the branch is kept and the next prompt starts a fresh worktree. */
  worktree: 'active' | 'released' | 'none'
  /** A close found work that is not on the remote and kept the worktree. */
  keptUnpushed: boolean
  unpushedReason: string | null
}

export interface ChatThreadCloseResponse extends ChatThreadResponse {
  bot: ChatThreadBot
  released: boolean
  keptUnpushed: boolean
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

export const chatThreadLink = (slug: string, threadId: string) => `/p/${slug}?thread=${encodeURIComponent(threadId)}`

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
export function projectThreadsPath(projectSlug: string, agentId?: string): string {
  const base = `${PROJECTS_PATH}/${encodeURIComponent(projectSlug)}/threads`
  return agentId ? `${base}?agent=${encodeURIComponent(agentId)}` : base
}

export const projectThreadPath = (projectSlug: string, threadId: string) => `${projectThreadsPath(projectSlug)}/${encodeURIComponent(threadId)}`
export const threadReadPath = (projectSlug: string, threadId: string) => `${projectThreadPath(projectSlug, threadId)}/read`
export const threadPromptPath = (projectSlug: string, threadId: string) => `${projectThreadPath(projectSlug, threadId)}/prompt`
export const threadCancelPath = (projectSlug: string, threadId: string) => `${projectThreadPath(projectSlug, threadId)}/cancel`
/** Bot threads only: cancels a running turn and releases the worktree unless it holds unpushed work. */
export const threadClosePath = (projectSlug: string, threadId: string) => `${projectThreadPath(projectSlug, threadId)}/close`
export const chatAgentOptionsPath = (projectSlug: string, agentId: string) => `${projectThreadsPath(projectSlug)}/agents/${encodeURIComponent(agentId)}/options`
