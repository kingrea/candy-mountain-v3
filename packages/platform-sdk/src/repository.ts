export const REPOSITORY_HOSTS = ['github', 'bitbucket'] as const
export type RepositoryHost = (typeof REPOSITORY_HOSTS)[number]

export const REPOSITORY_HOST_NAMES: Record<RepositoryHost, string> = { github: 'GitHub', bitbucket: 'Bitbucket' }

export const DEFAULT_BRANCH_LIST_LIMIT = 30
/** Both hosts cap a single page at 100, and the list is never paginated. */
export const MAX_BRANCH_LIST_LIMIT = 100

export interface RepositoryBranch {
  name: string
  sha: string
  /** ISO timestamp of the head commit, when the host reports one. */
  committedAt: string | null
}

export interface RepositoryBranchList {
  defaultBranch: string
  /** Most recently committed first. */
  branches: RepositoryBranch[]
}

export const REPOSITORY_ERROR_CODES = ['no_token', 'unauthorized', 'forbidden', 'not_found', 'rate_limited', 'unavailable', 'host_error', 'invalid_response'] as const
export type RepositoryErrorCode = (typeof REPOSITORY_ERROR_CODES)[number]

export function clampBranchListLimit(limit: unknown): number {
  const n = typeof limit === 'string' && limit.trim() !== '' ? Number(limit) : limit
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_BRANCH_LIST_LIMIT
  return Math.min(MAX_BRANCH_LIST_LIMIT, Math.max(1, Math.trunc(n)))
}
