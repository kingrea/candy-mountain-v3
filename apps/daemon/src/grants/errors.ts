import type { GrantErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<GrantErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  role_not_found: 422,
  target_not_found: 422,
  invalid_rung: 422,
}

export class GrantError extends Error {
  readonly code: GrantErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: GrantErrorCode, message: string) {
    super(message)
    this.name = 'GrantError'
    this.code = code
    this.status = STATUS[code]
  }
}
