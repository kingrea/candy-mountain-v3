export const PROJECTS_PATH = '/projects'
export const ORGANISATIONS_PATH = '/organisations'

export const PROJECT_SOURCE_KINDS = ['local-path'] as const
export type ProjectSourceKind = (typeof PROJECT_SOURCE_KINDS)[number]

export interface LocalPathSource {
  kind: 'local-path'
  path: string
}

export type ProjectSource = LocalPathSource

export interface PathVerification {
  checkedAt: string
  /** False when the path is missing or is not a directory. */
  pathExists: boolean
  hasBeads: boolean
  isGitRepo: boolean
  hasRemote: boolean
  remoteName: string | null
  remoteUrl: string | null
}

export const PROJECT_COLOR_PATTERN = /^#[0-9a-f]{6}$/
export const PROJECT_COLOR_PALETTE = [
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

export interface Project {
  id: string
  slug: string
  name: string
  color: string
  organisationId: string | null
  archived: boolean
  archivedAt: string | null
  source: ProjectSource
  verification: PathVerification
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

export interface CreateProjectRequest {
  name: string
  slug?: string
  color?: string
  organisationId?: string | null
  source: ProjectSource
}

export interface UpdateProjectRequest {
  name?: string
  slug?: string
  color?: string
  organisationId?: string | null
  source?: ProjectSource
}

export interface VerifyPathRequest {
  path: string
}

export interface OrganisationResponse {
  organisation: Organisation
}

export interface OrganisationListResponse {
  organisations: Organisation[]
}

export interface ProjectResponse {
  project: Project
}

export interface ProjectListResponse {
  projects: Project[]
}

export interface VerifyPathResponse {
  verification: PathVerification
}

export const PROJECT_ERROR_CODES = [
  'invalid_request',
  'not_found',
  'slug_taken',
  'invalid_path',
  'path_not_found',
  'organisation_not_found',
] as const
export type ProjectErrorCode = (typeof PROJECT_ERROR_CODES)[number]
