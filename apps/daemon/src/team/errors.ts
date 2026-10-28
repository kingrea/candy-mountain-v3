import type { TeamErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<TeamErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  slack_member_taken: 409,
  unknown_bot: 422,
}

export class TeamError extends Error {
  readonly code: TeamErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: TeamErrorCode, message: string) {
    super(message)
    this.name = 'TeamError'
    this.code = code
    this.status = STATUS[code]
  }
}
