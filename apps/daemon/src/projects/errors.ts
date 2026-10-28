import type { ProjectErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<ProjectErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  slug_taken: 409,
  invalid_path: 422,
  path_not_found: 422,
  organisation_not_found: 422,
}

export class ProjectError extends Error {
  readonly code: ProjectErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: ProjectErrorCode, message: string) {
    super(message)
    this.name = 'ProjectError'
    this.code = code
    this.status = STATUS[code]
  }
}
