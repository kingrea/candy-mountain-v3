import type { EnvironmentErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<EnvironmentErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  name_taken: 409,
  unknown_source: 422,
  invalid_settings: 422,
}

export class EnvironmentError extends Error {
  readonly code: EnvironmentErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: EnvironmentErrorCode, message: string) {
    super(message)
    this.name = 'EnvironmentError'
    this.code = code
    this.status = STATUS[code]
  }
}
