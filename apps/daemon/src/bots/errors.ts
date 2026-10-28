import type { BotErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<BotErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  family_unavailable: 422,
  repository_not_configured: 422,
  invalid_secrets: 422,
  name_taken: 409,
  secrets_locked: 409,
  persona_not_set: 422,
  persona_missing: 422,
  persona_check_failed: 502,
}

export class BotError extends Error {
  readonly code: BotErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: BotErrorCode, message: string) {
    super(message)
    this.name = 'BotError'
    this.code = code
    this.status = STATUS[code]
  }
}
