import type { WorkspaceErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<WorkspaceErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  slug_taken: 409,
  organisation_not_found: 422,
}

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceError'
    this.code = code
    this.status = STATUS[code]
  }
}
