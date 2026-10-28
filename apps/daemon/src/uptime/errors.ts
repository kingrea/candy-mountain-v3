import type { MonitorErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<MonitorErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  unknown_source: 422,
  invalid_options: 422,
}

export class MonitorError extends Error {
  readonly code: MonitorErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: MonitorErrorCode, message: string) {
    super(message)
    this.name = 'MonitorError'
    this.code = code
    this.status = STATUS[code]
  }
}
