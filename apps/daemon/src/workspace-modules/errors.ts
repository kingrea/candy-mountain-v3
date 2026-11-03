import type { WorkspaceModulesErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<WorkspaceModulesErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  module_not_found: 422,
}

export class WorkspaceModulesError extends Error {
  readonly code: WorkspaceModulesErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: WorkspaceModulesErrorCode, message: string) {
    super(message)
    this.name = 'WorkspaceModulesError'
    this.code = code
    this.status = STATUS[code]
  }
}
