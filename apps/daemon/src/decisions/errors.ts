import type { DecisionErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<DecisionErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  already_answered: 409,
  decision_expired: 409,
  option_not_offered: 422,
  invalid_answer: 422,
}

export class DecisionError extends Error {
  readonly code: DecisionErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: DecisionErrorCode, message: string) {
    super(message)
    this.name = 'DecisionError'
    this.code = code
    this.status = STATUS[code]
  }
}
