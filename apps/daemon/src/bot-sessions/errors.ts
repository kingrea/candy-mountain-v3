import type { BotStartErrorReason } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<BotStartErrorReason, ContentfulStatusCode> = {
  persona_missing: 422,
  persona_check_failed: 502,
  plugin_unhealthy: 422,
  repository_not_configured: 422,
  worktree_cap: 409,
  worktree_failed: 502,
  worktree_released: 409,
  posture_refused: 422,
  dependencies_failed: 422,
}

/** A bot session that could not start or continue, with a reason the console or Slack can show as is. */
export class BotStartError extends Error {
  readonly reason: BotStartErrorReason
  readonly status: ContentfulStatusCode

  constructor(reason: BotStartErrorReason, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BotStartError'
    this.reason = reason
    this.status = STATUS[reason]
  }
}
