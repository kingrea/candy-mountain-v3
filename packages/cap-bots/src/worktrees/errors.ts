import type { ContentfulStatusCode } from 'hono/utils/http-status'

export const WORKTREE_ERROR_CODES = [
  'invalid_request',
  'not_found',
  'lease_exists',
  'branch_exists',
  'cap_reached',
  'base_branch_refused',
  'base_branch_not_found',
  'clone_unavailable',
  'fetch_failed',
  'git_failed',
] as const
export type WorktreeErrorCode = typeof WORKTREE_ERROR_CODES[number]

const STATUS: Record<WorktreeErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  lease_exists: 409,
  branch_exists: 409,
  cap_reached: 409,
  base_branch_refused: 422,
  base_branch_not_found: 422,
  clone_unavailable: 422,
  fetch_failed: 502,
  git_failed: 500,
}

export class WorktreeError extends Error {
  readonly code: WorktreeErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: WorktreeErrorCode, message: string) {
    super(message)
    this.name = 'WorktreeError'
    this.code = code
    this.status = STATUS[code]
  }
}
