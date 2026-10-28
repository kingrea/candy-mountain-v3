import type { SessionErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<SessionErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  session_busy: 409,
  auth_required: 409,
  family_unavailable: 422,
  agent_failed: 502,
}

export class SessionError extends Error {
  readonly code: SessionErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: SessionErrorCode, message: string) {
    super(message)
    this.name = 'SessionError'
    this.code = code
    this.status = STATUS[code]
  }
}
