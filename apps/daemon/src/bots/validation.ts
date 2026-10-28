import {
  BOT_BASE_BRANCH_PATTERN,
  BOT_FAMILIES,
  BOT_NAME_MAX_LENGTH,
  BOT_PERSONA_NAME_PATTERN,
  BOT_SECRET_LABELS,
  BOT_SECRET_NAMES,
  BOT_SECRET_PREFIXES,
  BOT_WRITE_SCOPES,
  SLACK_CHANNEL_ID_PATTERN,
  type BotAnswersIn,
  type BotFamily,
  type BotSecretName,
  type BotSecretValues,
  type BotWriteScope,
} from '@candy-mountain/shared'
import { BotError } from './errors'

export interface BotFields {
  name: string
  family: BotFamily
  writeScope: BotWriteScope
  baseBranch: string | null
  personaName: string | null
  answersIn: BotAnswersIn
}

export interface CreateBotInput extends BotFields {
  secrets: BotSecretValues
}

export interface UpdateBotInput extends Partial<BotFields> {
  secrets: BotSecretValues
}

const FIELDS = ['name', 'family', 'writeScope', 'baseBranch', 'personaName', 'answersIn', 'secrets']

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function invalid(message: string): never {
  throw new BotError('invalid_request', message)
}

function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : invalid('name is required')
  if (!name) invalid('name is required')
  if (name.length > BOT_NAME_MAX_LENGTH) invalid(`name must be at most ${BOT_NAME_MAX_LENGTH} characters`)
  return name
}

function parseOneOf<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  if (!(allowed as readonly unknown[]).includes(value)) invalid(`${field} must be one of ${allowed.join(', ')}`)
  return value as T
}

/** Blank means "not set", so an emptied form input clears the field. */
function parseOptionalText(field: string, value: unknown, pattern: RegExp): string | null {
  if (value === null) return null
  if (typeof value !== 'string') invalid(`${field} must be a string or null`)
  const text = value.trim()
  if (!text) return null
  if (!pattern.test(text)) invalid(`${field} "${text}" is not valid`)
  return text
}

function parseAnswersIn(value: unknown): BotAnswersIn {
  if (!isObject(value)) invalid('answersIn must be { anywhere: true } or { channels: [...] }')
  const keys = Object.keys(value)
  if (keys.length === 1 && value.anywhere === true) return { anywhere: true }
  if (keys.length !== 1 || !Array.isArray(value.channels)) invalid('answersIn must be { anywhere: true } or { channels: [...] }')
  const channels = value.channels.map((c) => {
    const id = typeof c === 'string' ? c.trim() : ''
    if (!SLACK_CHANNEL_ID_PATTERN.test(id)) invalid(`"${String(c)}" is not a Slack channel id (like C0123ABCD)`)
    return id
  })
  if (!channels.length) invalid('answersIn.channels needs at least one channel id')
  return { channels: [...new Set(channels)] }
}

function parseSecrets(value: unknown): BotSecretValues {
  if (value === undefined) return {}
  if (!isObject(value)) invalid('secrets must be an object of secret name to value')
  const unknown = Object.keys(value).filter(name => !(BOT_SECRET_NAMES as readonly string[]).includes(name))
  if (unknown.length) throw new BotError('invalid_secrets', `Bots have no secret(s) ${unknown.join(', ')}`)
  for (const name of Object.keys(value) as BotSecretName[]) {
    const secret = value[name]
    if (secret !== null && typeof secret !== 'string') invalid(`Secret "${name}" must be a string, or null to clear it`)
    if (secret && !secret.startsWith(BOT_SECRET_PREFIXES[name])) {
      throw new BotError('invalid_secrets', `${BOT_SECRET_LABELS[name]} should start with ${BOT_SECRET_PREFIXES[name]}`)
    }
  }
  return value as BotSecretValues
}

function body(value: unknown): Record<string, unknown> {
  if (!isObject(value)) invalid('Request body must be an object')
  const unknown = Object.keys(value).filter(k => !FIELDS.includes(k))
  if (unknown.length) invalid(`Unknown field(s) ${unknown.join(', ')}`)
  return value
}

export function parseCreateBot(input: unknown): CreateBotInput {
  const b = body(input)
  return {
    name: parseName(b.name),
    family: parseOneOf('family', b.family, BOT_FAMILIES),
    writeScope: b.writeScope === undefined ? 'read-only' : parseOneOf('writeScope', b.writeScope, BOT_WRITE_SCOPES),
    baseBranch: b.baseBranch === undefined ? null : parseOptionalText('baseBranch', b.baseBranch, BOT_BASE_BRANCH_PATTERN),
    personaName: b.personaName === undefined ? null : parseOptionalText('personaName', b.personaName, BOT_PERSONA_NAME_PATTERN),
    answersIn: b.answersIn === undefined ? { anywhere: true } : parseAnswersIn(b.answersIn),
    secrets: parseSecrets(b.secrets),
  }
}

export function parseUpdateBot(input: unknown): UpdateBotInput {
  const b = body(input)
  const update: UpdateBotInput = { secrets: parseSecrets(b.secrets) }
  if (b.name !== undefined) update.name = parseName(b.name)
  if (b.family !== undefined) update.family = parseOneOf('family', b.family, BOT_FAMILIES)
  if (b.writeScope !== undefined) update.writeScope = parseOneOf('writeScope', b.writeScope, BOT_WRITE_SCOPES)
  if (b.baseBranch !== undefined) update.baseBranch = parseOptionalText('baseBranch', b.baseBranch, BOT_BASE_BRANCH_PATTERN)
  if (b.personaName !== undefined) update.personaName = parseOptionalText('personaName', b.personaName, BOT_PERSONA_NAME_PATTERN)
  if (b.answersIn !== undefined) update.answersIn = parseAnswersIn(b.answersIn)
  return update
}
