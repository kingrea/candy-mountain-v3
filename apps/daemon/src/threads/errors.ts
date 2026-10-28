import type { ThreadErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<ThreadErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  unsupported_agent: 422,
  thread_busy: 409,
}

export class ThreadError extends Error {
  readonly code: ThreadErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: ThreadErrorCode, message: string) {
    super(message)
    this.name = 'ThreadError'
    this.code = code
    this.status = STATUS[code]
  }
}
