import type { AgentSession } from './sessions'
import type { ChatThread } from './threads'

/** Who holds a bot session: a console thread in the chat panel, or a Slack thread. */
export const BOT_SESSION_HOLDER_KINDS = ['console', 'slack'] as const
export type BotSessionHolderKind = (typeof BOT_SESSION_HOLDER_KINDS)[number]

export interface BotSessionHolder {
  kind: BotSessionHolderKind
  /** The console thread id, or the Slack thread key the Slack surface chooses. */
  id: string
}

/**
 * Why a bot session could not start, or continue. `dependencies_failed` is never fatal: it arrives as a warning
 * and in the agent's surface instructions.
 */
export const BOT_START_ERROR_REASONS = [
  'persona_missing',
  'persona_check_failed',
  'plugin_unhealthy',
  'repository_not_configured',
  'worktree_cap',
  'worktree_failed',
  'worktree_released',
  'posture_refused',
  'dependencies_failed',
] as const
export type BotStartErrorReason = (typeof BOT_START_ERROR_REASONS)[number]

export interface BotSessionLease {
  id: string
  /** Absolute worktree directory on the daemon host; the session's `cwd`. */
  path: string
  branch: string
  baseBranch: string
  dependencies: { status: 'installed' | 'skipped' | 'failed', checkedAt: string } | null
  /** Set once a close found uncommitted or unpushed work and kept the worktree. */
  unpushedWork: boolean
  unpushedReason: string | null
}

export interface BotSessionWarning {
  reason: Extract<BotStartErrorReason, 'dependencies_failed'>
  message: string
}

/** Body of `POST /projects/:slug/bots/:id/sessions`; `threadId` resumes the console thread that holds a session. */
export interface BotSessionStartRequest {
  threadId?: string
}

export interface BotSessionStartResponse {
  session: AgentSession
  lease: BotSessionLease
  /** The console thread holding the session; null for a Slack holder. */
  thread: ChatThread | null
  /** True when the holder already had a session and its worktree was resumed. */
  resumed: boolean
  warnings: BotSessionWarning[]
}

export interface BotSessionCloseResponse {
  session: AgentSession
  lease: BotSessionLease | null
  released: boolean
  /** The worktree stayed because it holds work that is not on the remote; `lease.unpushedReason` says what. */
  keptUnpushed: boolean
}

export const BOTS_CAPABILITY_ID = 'bots'

/** Chat agent ids of bots are namespaced so they never collide with a manifest agent. */
export const BOT_AGENT_ID_PREFIX = 'bot:'
export const botAgentId = (botId: string) => `${BOT_AGENT_ID_PREFIX}${botId}`
export const botIdOfAgent = (agentId: string): string | null => (agentId.startsWith(BOT_AGENT_ID_PREFIX) ? agentId.slice(BOT_AGENT_ID_PREFIX.length) || null : null)

export const botSessionsPath = (slug: string, botId: string) => `/projects/${slug}/bots/${botId}/sessions`
export const botSessionClosePath = (slug: string, botId: string, sessionId: string) => `${botSessionsPath(slug, botId)}/${sessionId}/close`
