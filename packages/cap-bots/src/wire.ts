import type { AgentSession, BotSlackConnection, ChatThread, ChatThreadResponse, PluginSecretState, RegistryAgent } from '@candy-mountain/platform-sdk'

export const BOT_FAMILIES = ['claude-code', 'codex'] as const
export type BotFamily = (typeof BOT_FAMILIES)[number]

export const BOT_FAMILY_NAMES: Record<BotFamily, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
}

export const BOT_WRITE_SCOPES = ['read-only', 'write-confirm', 'write-auto'] as const
export type BotWriteScope = (typeof BOT_WRITE_SCOPES)[number]

export const BOT_WRITE_SCOPE_NAMES: Record<BotWriteScope, string> = {
  'read-only': 'Read-only',
  'write-confirm': 'Write (confirmation prompts)',
  'write-auto': 'Write (auto)',
}

export const BOT_SECRET_NAMES = ['slackBotToken', 'slackAppToken'] as const
export type BotSecretName = (typeof BOT_SECRET_NAMES)[number]

export const BOT_SECRET_LABELS: Record<BotSecretName, string> = {
  slackBotToken: 'Slack bot token',
  slackAppToken: 'Slack app-level token',
}

/** Slack hands these out with fixed prefixes, so a swapped pair is caught on save. */
export const BOT_SECRET_PREFIXES: Record<BotSecretName, string> = {
  slackBotToken: 'xoxb-',
  slackAppToken: 'xapp-',
}

export const BOT_NAME_MAX_LENGTH = 80
/** Becomes a file name: `.claude/agents/<name>.md` or `.agents/<name>.md`. */
export const BOT_PERSONA_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** Same rule as the Repository plugin's default branch. */
export const BOT_BASE_BRANCH_PATTERN = /^[^\s~^:?*[\\]+$/

export type BotAnswersIn = { anywhere: true } | { channels: string[] }

export const BOT_PERSONA_STATUSES = ['unverified', 'verified', 'missing'] as const
export type BotPersonaStatus = (typeof BOT_PERSONA_STATUSES)[number]

export interface BotPersona {
  /** Null until a persona name is chosen. */
  name: string | null
  /** `unverified` until the persona check runs, and again after the name, family or base branch changes. */
  status: BotPersonaStatus
  checkedAt: string | null
  /** Why the last check failed, e.g. which file is missing on which branch. */
  reason: string | null
}

export type BotStatus = 'active' | 'not_configured' | { warnings: string[] }

export interface Bot {
  id: string
  projectId: string
  name: string
  family: BotFamily
  writeScope: BotWriteScope
  /** As saved; null means "the Repository plugin's default branch". */
  baseBranch: string | null
  /** `baseBranch`, or the repository's default branch read now; null when that could not be read. */
  effectiveBaseBranch: string | null
  persona: BotPersona
  answersIn: BotAnswersIn
  /** Values are never sent. */
  secrets: Record<BotSecretName, PluginSecretState>
  status: BotStatus
  createdAt: string
  updatedAt: string
}

/** A secret value, or null to clear it; an omitted or empty value leaves the secret untouched. */
export type BotSecretValues = Partial<Record<BotSecretName, string | null>>

export interface CreateBotRequest {
  name: string
  family: BotFamily
  /** Defaults to `read-only`. */
  writeScope?: BotWriteScope
  /** Blank or null uses the Repository plugin's default branch. */
  baseBranch?: string | null
  personaName?: string | null
  /** Defaults to `{ anywhere: true }`. */
  answersIn?: BotAnswersIn
  secrets?: BotSecretValues
}

export type UpdateBotRequest = Partial<CreateBotRequest>

export interface BotListResponse {
  bots: Bot[]
}

export interface BotResponse {
  bot: Bot
}

export const workspaceBotsPath = (slug: string) => `/workspaces/${slug}/bots`

export const botPersonaPath = (family: BotFamily, name: string) =>
  family === 'claude-code' ? `.claude/agents/${name}.md` : `.agents/${name}.md`

export const botPersonaMissingReason = (family: BotFamily, name: string, branch: string) =>
  `${BOT_FAMILY_NAMES[family]} persona file ${botPersonaPath(family, name)} was not found on ${branch}`

export const BOT_PERSONA_FILE_KEYS = { 'claude-code': 'claudeCode', 'codex': 'codex' } as const satisfies Record<BotFamily, string>

/** Which families' persona files exist on `branch`; a family whose file is missing cannot be chosen. */
export interface BotPersonaFiles {
  branch: string
  claudeCode: boolean
  codex: boolean
}

/** Body of `POST /workspaces/:slug/bots/check-persona`, for a bot that is not saved yet. */
export interface BotPersonaPreviewRequest {
  personaName: string
  /** Blank or null uses the Repository plugin's default branch. */
  baseBranch?: string | null
}

export type BotPersonaPreviewResponse = BotPersonaFiles

/** Response of `POST /workspaces/:slug/bots/:id/check-persona`; status and reason are for the bot's own family. */
export interface BotPersonaCheckResponse extends BotPersonaFiles {
  checkedAt: string
  status: Exclude<BotPersonaStatus, 'unverified'>
  reason: string | null
  bot: Bot
}

export const BOT_ERROR_CODES = [
  'invalid_request',
  'not_found',
  'family_unavailable',
  'repository_not_configured',
  'invalid_secrets',
  'name_taken',
  'secrets_locked',
  'persona_not_set',
  'persona_missing',
  'persona_check_failed',
] as const
export type BotErrorCode = (typeof BOT_ERROR_CODES)[number]

// Bot sessions.

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

/** Body of `POST /workspaces/:slug/bots/:id/sessions`; `threadId` resumes the console thread that holds a session. */
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

/** A bot thread's `extension`: where its current session works. */
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

/** Null for a thread of any other agent. */
export const chatThreadBot = (response: Pick<ChatThreadResponse, 'extension'>): ChatThreadBot | null => (response.extension as ChatThreadBot | undefined) ?? null

export const BOTS_CAPABILITY_ID = 'bots'

/** A bot agent's registry `extension`. */
export interface RegistryAgentBot {
  id: string
  writeScope: BotWriteScope
  /** Null means the repository's default branch. */
  baseBranch: string | null
}

/** Null for an agent of any other capability. */
export const registryAgentBot = (agent: Pick<RegistryAgent, 'capabilityId' | 'extension'>): RegistryAgentBot | null =>
  (agent.capabilityId === BOTS_CAPABILITY_ID ? (agent.extension as RegistryAgentBot | undefined) ?? null : null)

/** Chat agent ids of bots are namespaced so they never collide with a manifest agent. */
export const BOT_AGENT_ID_PREFIX = 'bot:'
export const botAgentId = (botId: string) => `${BOT_AGENT_ID_PREFIX}${botId}`
export const botIdOfAgent = (agentId: string): string | null => (agentId.startsWith(BOT_AGENT_ID_PREFIX) ? agentId.slice(BOT_AGENT_ID_PREFIX.length) || null : null)

export const botSessionsPath = (slug: string, botId: string) => `/workspaces/${slug}/bots/${botId}/sessions`
export const botSessionClosePath = (slug: string, botId: string, sessionId: string) => `${botSessionsPath(slug, botId)}/${sessionId}/close`

// The bot's Slack connection, served by the status route the bots definition mounts.

export interface BotSlackConnectionResponse {
  connection: BotSlackConnection
}

export const botSlackConnectionPath = (slug: string, botId: string) => `${workspaceBotsPath(slug)}/${botId}/slack`
