import type { PluginSecretState } from './plugin-instances'

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
export const SLACK_CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{2,}$/

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

export const projectBotsPath = (slug: string) => `/projects/${slug}/bots`

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

/** Body of `POST /projects/:slug/bots/check-persona`, for a bot that is not saved yet. */
export interface BotPersonaPreviewRequest {
  personaName: string
  /** Blank or null uses the Repository plugin's default branch. */
  baseBranch?: string | null
}

export type BotPersonaPreviewResponse = BotPersonaFiles

/** Response of `POST /projects/:slug/bots/:id/check-persona`; status and reason are for the bot's own family. */
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
