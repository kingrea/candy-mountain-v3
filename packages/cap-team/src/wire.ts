export const workspaceTeamPath = (slug: string) => `/workspaces/${slug}/team`

// The bots list the roster scopes members to, as a data-level edge like the daemon's bots table read: bots depends on team, so team may not import the bots package.
export const teamBotsPath = (slug: string) => `/workspaces/${slug}/bots`

export interface TeamBot {
  id: string
  name: string
}

export interface TeamBotListResponse {
  bots: TeamBot[]
}

export const TEAM_NAME_MAX_LENGTH = 100
export const TEAM_EMAIL_MAX_LENGTH = 254

export type TeamBotScope = { all: true } | { botIds: string[] }

export interface TeamMember {
  id: string
  projectId: string
  displayName: string
  email: string | null
  slackMemberId: string
  botScope: TeamBotScope
  lastActiveAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateTeamMemberRequest {
  displayName: string
  slackMemberId: string
  email?: string | null
  botScope?: TeamBotScope
}

export type UpdateTeamMemberRequest = Partial<CreateTeamMemberRequest>

export interface TeamMemberListResponse {
  members: TeamMember[]
}

export interface TeamMemberResponse {
  member: TeamMember
}

export const TEAM_ERROR_CODES = ['invalid_request', 'not_found', 'slack_member_taken', 'unknown_bot'] as const
export type TeamErrorCode = (typeof TEAM_ERROR_CODES)[number]
