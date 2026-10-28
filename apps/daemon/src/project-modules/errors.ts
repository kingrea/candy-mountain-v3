import type { ProjectModulesErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<ProjectModulesErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  module_not_found: 422,
}

export class ProjectModulesError extends Error {
  readonly code: ProjectModulesErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: ProjectModulesErrorCode, message: string) {
    super(message)
    this.name = 'ProjectModulesError'
    this.code = code
    this.status = STATUS[code]
  }
}
