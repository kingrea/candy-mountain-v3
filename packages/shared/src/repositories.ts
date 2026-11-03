import { WORKSPACES_PATH } from './workspaces'

/** The product capability owning a workspace's repository; service-only, so it has no manifest. */
export const REPOSITORY_CAPABILITY_ID = 'repository'

export const REPOSITORY_SOURCE_KINDS = ['local-path'] as const
export type RepositorySourceKind = (typeof REPOSITORY_SOURCE_KINDS)[number]

export interface LocalPathSource {
  kind: 'local-path'
  path: string
}

export type RepositorySource = LocalPathSource

export interface RepositoryVerification {
  checkedAt: string
  /** False when the path is missing or is not a directory. */
  pathExists: boolean
  hasBeads: boolean
  isGitRepo: boolean
  hasRemote: boolean
  remoteName: string | null
  remoteUrl: string | null
}

/** A workspace's repository: at most one per workspace, removed with it. */
export interface Repository {
  workspaceId: string
  source: RepositorySource
  verification: RepositoryVerification
  createdAt: string
  updatedAt: string
}

export interface SetRepositoryRequest {
  source: RepositorySource
}

export interface CheckRepositoryPathRequest {
  path: string
}

export interface RepositoryResponse {
  repository: Repository
}

export interface RepositoryCheckResponse {
  verification: RepositoryVerification
}

export const REPOSITORY_RECORD_ERROR_CODES = ['invalid_request', 'not_found', 'invalid_path', 'path_not_found'] as const
export type RepositoryRecordErrorCode = (typeof REPOSITORY_RECORD_ERROR_CODES)[number]

/** Under the workspace prefix: `GET` reads, `PUT` sets (checking the path), `POST .../verify` re-checks. */
export const repositoryPath = (slug: string) => `${WORKSPACES_PATH}/${slug}/repository`
export const repositoryVerifyPath = (slug: string) => `${repositoryPath(slug)}/verify`
/** Checks a path without saving anything, for a form previewing a path before the workspace exists. */
export const REPOSITORY_CHECK_PATH = `${WORKSPACES_PATH}/repository/check`
