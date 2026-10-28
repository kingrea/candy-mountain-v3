import type { ActivityErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<ActivityErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  payload_too_large: 413,
}

export class ActivityError extends Error {
  readonly code: ActivityErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: ActivityErrorCode, message: string) {
    super(message)
    this.name = 'ActivityError'
    this.code = code
    this.status = STATUS[code]
  }
}
