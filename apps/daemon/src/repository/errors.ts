import type { RepositoryRecordErrorCode } from '@candy-mountain/platform-sdk'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<RepositoryRecordErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  invalid_path: 422,
  path_not_found: 422,
}

export class RepositoryError extends Error {
  readonly code: RepositoryRecordErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: RepositoryRecordErrorCode, message: string) {
    super(message)
    this.name = 'RepositoryError'
    this.code = code
    this.status = STATUS[code]
  }
}
