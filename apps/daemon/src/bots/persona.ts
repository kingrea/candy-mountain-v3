import {
  BOT_BASE_BRANCH_PATTERN,
  BOT_FAMILY_NAMES,
  BOT_PERSONA_FILE_KEYS,
  BOT_PERSONA_NAME_PATTERN,
  botPersonaMissingReason,
  botPersonaPath,
  REPOSITORY_HOST_NAMES,
  type Bot,
  type BotFamily,
  type BotPersonaCheckResponse,
  type BotPersonaFiles,
} from '@candy-mountain/shared'
import { resolvePluginInstance } from '../plugins/instances/instances'
import { createRepositoryOperations, repositoryConfig, repositoryPluginType, RepositoryHostError } from '../plugins/repository'
import { createPluginSecrets } from '../plugins/secrets'
import { getBot, recordBotPersonaCheck, type BotReadDeps, type BotReadOptions } from './bots'
import { BotError } from './errors'

const PERSONA_CHECK_TIMEOUT_S = 10

interface PersonaLookup extends BotPersonaFiles {
  /** Set when the branch itself is missing, so neither file could be looked up. */
  branchMissing: string | null
}

/** Thrown by `assertBotPersonaBeforeSession` when the bot's own family has no persona file on its base branch. */
export class BotPersonaMissingError extends BotError {
  readonly family: BotFamily
  readonly path: string
  readonly branch: string

  constructor(bot: Pick<Bot, 'name' | 'family'>, personaName: string, branch: string, reason: string) {
    super('persona_missing', `Bot "${bot.name}" cannot start: ${reason}`)
    this.name = 'BotPersonaMissingError'
    this.family = bot.family
    this.path = botPersonaPath(bot.family, personaName)
    this.branch = branch
  }
}

/** Reads through the host API rather than a checkout, so it sees the branch as pushed. */
async function lookupPersonaFiles(deps: BotReadDeps, projectId: string, personaName: string, baseBranch: string | null, options: BotReadOptions): Promise<PersonaLookup> {
  const instance = resolvePluginInstance(deps, projectId, 'repository')
  if (!instance) throw new BotError('repository_not_configured', 'Set up the Repository plugin for this project before checking a persona')
  const config = repositoryConfig(instance.config)
  const timeout = AbortSignal.timeout(PERSONA_CHECK_TIMEOUT_S * 1000)
  const operations = createRepositoryOperations(config, createPluginSecrets(deps.secretsReader, instance.id, repositoryPluginType), {
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  })

  let branch = baseBranch
  try {
    branch ??= await operations.getDefaultBranch()
    const exists = (family: BotFamily) => operations.fileExists(botPersonaPath(family, personaName), branch!)
    const [claudeCode, codex] = await Promise.all([exists('claude-code'), exists('codex')])
    return { branch, claudeCode, codex, branchMissing: null }
  }
  catch (error) {
    // Once the branch is known, a not_found from fileExists can only mean the branch is gone.
    if (branch && error instanceof RepositoryHostError && error.code === 'not_found') {
      return { branch, claudeCode: false, codex: false, branchMissing: error.message }
    }
    if (error instanceof RepositoryHostError) throw new BotError('persona_check_failed', `Could not check the persona: ${error.message}`)
    if (timeout.aborted) {
      throw new BotError('persona_check_failed', `Could not check the persona: ${REPOSITORY_HOST_NAMES[config.host]} did not answer within ${PERSONA_CHECK_TIMEOUT_S} s`)
    }
    throw error
  }
}

function missingReason(family: BotFamily, personaName: string, lookup: PersonaLookup): string {
  if (!lookup.branchMissing) return botPersonaMissingReason(family, personaName, lookup.branch)
  return `${BOT_FAMILY_NAMES[family]} persona file ${botPersonaPath(family, personaName)} could not be looked up: ${lookup.branchMissing}`
}

/**
 * Looks up both families' persona files on the bot's base branch and records the result for the bot's own family.
 * A host failure throws `persona_check_failed` and records nothing, since it says nothing about the persona.
 */
export async function checkBotPersona(deps: BotReadDeps, bot: Bot, options: BotReadOptions = {}): Promise<BotPersonaCheckResponse> {
  const personaName = bot.persona.name
  if (!personaName) throw new BotError('persona_not_set', `Bot "${bot.name}" has no persona name to check`)
  const lookup = await lookupPersonaFiles(deps, bot.projectId, personaName, bot.effectiveBaseBranch, options)
  const found = lookup[BOT_PERSONA_FILE_KEYS[bot.family]]
  const status = found ? 'verified' : 'missing'
  const reason = found ? null : missingReason(bot.family, personaName, lookup)

  const recorded = recordBotPersonaCheck(deps.db, bot.id, bot.updatedAt, { status, reason })
  const refreshed = await getBot(deps, bot.id, options)
  const checkedAt = (recorded ? refreshed.persona.checkedAt : null) ?? new Date().toISOString()
  return { branch: lookup.branch, claudeCode: lookup.claudeCode, codex: lookup.codex, checkedAt, status, reason, bot: refreshed }
}

/** Re-runs the check at session start so a persona deleted after setup stops the bot with the file it needs. */
export async function assertBotPersonaBeforeSession(deps: BotReadDeps, bot: Bot, options: BotReadOptions = {}): Promise<BotPersonaCheckResponse> {
  const check = await checkBotPersona(deps, bot, options)
  if (check.status === 'missing') throw new BotPersonaMissingError(bot, bot.persona.name!, check.branch, check.reason!)
  return check
}

/** For a bot that is not saved yet: which families could use this persona, without recording anything. */
export async function previewBotPersona(deps: BotReadDeps, projectId: string, personaName: string, baseBranch: string | null, options: BotReadOptions = {}): Promise<BotPersonaFiles> {
  const { branch, claudeCode, codex } = await lookupPersonaFiles(deps, projectId, personaName, baseBranch, options)
  return { branch, claudeCode, codex }
}

export function parsePersonaPreview(input: unknown): { personaName: string, baseBranch: string | null } {
  const invalid = (message: string): never => {
    throw new BotError('invalid_request', message)
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalid('Request body must be an object')
  const { personaName, baseBranch, ...rest } = input as Record<string, unknown>
  if (Object.keys(rest).length) invalid(`Unknown field(s) ${Object.keys(rest).join(', ')}`)
  const name = typeof personaName === 'string' ? personaName.trim() : ''
  if (!BOT_PERSONA_NAME_PATTERN.test(name)) invalid(name ? `personaName "${name}" is not valid` : 'personaName is required')
  if (baseBranch !== undefined && baseBranch !== null && typeof baseBranch !== 'string') invalid('baseBranch must be a string or null')
  const branch = typeof baseBranch === 'string' ? baseBranch.trim() : ''
  if (branch && !BOT_BASE_BRANCH_PATTERN.test(branch)) invalid(`baseBranch "${branch}" is not valid`)
  return { personaName: name, baseBranch: branch || null }
}
