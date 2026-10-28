import {
  SLACK_MEMBER_ID_PATTERN, TEAM_EMAIL_MAX_LENGTH, TEAM_NAME_MAX_LENGTH,
  type CreateTeamMemberRequest, type TeamBotScope, type UpdateTeamMemberRequest,
} from '@candy-mountain/shared'
import { TeamError } from './errors'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const invalid = (message: string) => new TeamError('invalid_request', message)

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid('Body must be a JSON object')
  return body as Record<string, unknown>
}

function parseName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('displayName must be a non-empty string')
  const name = value.trim()
  if (name.length > TEAM_NAME_MAX_LENGTH) throw invalid(`displayName must be at most ${TEAM_NAME_MAX_LENGTH} characters`)
  return name
}

function parseSlackId(value: unknown): string {
  if (typeof value !== 'string' || !SLACK_MEMBER_ID_PATTERN.test(value.trim())) throw invalid('slackMemberId must be a Slack member id such as U012ABCDE')
  return value.trim()
}

function parseEmail(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw invalid('email must be a string or null')
  const email = value.trim()
  if (email === '') return null
  if (email.length > TEAM_EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) throw invalid('email is not a valid address')
  return email
}

function parseScope(value: unknown): TeamBotScope {
  const scope = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (scope?.all === true && Object.keys(scope).length === 1) return { all: true }
  if (scope && Object.keys(scope).length === 1 && Array.isArray(scope.botIds) && scope.botIds.every(id => typeof id === 'string' && id !== '')) {
    return { botIds: [...new Set(scope.botIds as string[])] }
  }
  throw invalid('botScope must be { all: true } or { botIds: string[] }')
}

export function parseCreateTeamMember(body: unknown): Required<CreateTeamMemberRequest> {
  const raw = asObject(body)
  return {
    displayName: parseName(raw.displayName),
    slackMemberId: parseSlackId(raw.slackMemberId),
    email: raw.email === undefined ? null : parseEmail(raw.email),
    botScope: raw.botScope === undefined ? { botIds: [] } : parseScope(raw.botScope),
  }
}

export function parseUpdateTeamMember(body: unknown): UpdateTeamMemberRequest {
  const raw = asObject(body)
  const update: UpdateTeamMemberRequest = {}
  if (raw.displayName !== undefined) update.displayName = parseName(raw.displayName)
  if (raw.slackMemberId !== undefined) update.slackMemberId = parseSlackId(raw.slackMemberId)
  if (raw.email !== undefined) update.email = parseEmail(raw.email)
  if (raw.botScope !== undefined) update.botScope = parseScope(raw.botScope)
  return update
}
