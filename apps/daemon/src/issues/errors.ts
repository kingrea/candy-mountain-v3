import type { IssueErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<IssueErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  no_issue_tracker: 422,
  tracker_unavailable: 503,
  tracker_failed: 502,
  tracker_timeout: 504,
}

export class IssueError extends Error {
  readonly code: IssueErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: IssueErrorCode, message: string) {
    super(message)
    this.name = 'IssueError'
    this.code = code
    this.status = STATUS[code]
  }
}
