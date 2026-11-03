export const WORKSPACES_PATH = '/workspaces'
export const ORGANISATIONS_PATH = '/organisations'

export const WORKSPACE_COLOR_PATTERN = /^#[0-9a-f]{6}$/
export const WORKSPACE_COLOR_PALETTE = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#0ea5e9',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
] as const

export interface Organisation {
  id: string
  slug: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  id: string
  slug: string
  name: string
  color: string
  organisationId: string | null
  archived: boolean
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateOrganisationRequest {
  name: string
  slug?: string
}

export interface UpdateOrganisationRequest {
  name?: string
  slug?: string
}

export interface CreateWorkspaceRequest {
  name: string
  slug?: string
  color?: string
  organisationId?: string | null
}

export interface UpdateWorkspaceRequest {
  name?: string
  slug?: string
  color?: string
  organisationId?: string | null
}

export interface OrganisationResponse {
  organisation: Organisation
}

export interface OrganisationListResponse {
  organisations: Organisation[]
}

export interface WorkspaceResponse {
  workspace: Workspace
}

export interface WorkspaceListResponse {
  workspaces: Workspace[]
}

export const WORKSPACE_ERROR_CODES = [
  'invalid_request',
  'not_found',
  'slug_taken',
  'organisation_not_found',
] as const
export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number]
