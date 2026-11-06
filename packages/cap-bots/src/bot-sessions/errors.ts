import type { BotStartErrorReason } from '../wire'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { WorkspaceAgentError } from '@candy-mountain/platform-daemon'

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
export class BotStartError extends WorkspaceAgentError {
  readonly reason: BotStartErrorReason

  constructor(reason: BotStartErrorReason, message: string, options?: { cause?: unknown }) {
    // A released worktree ends the session; the thread service starts a fresh one in its place.
    super(reason, STATUS[reason], message, { ended: reason === 'worktree_released', cause: options?.cause })
    this.name = 'BotStartError'
    this.reason = reason
  }
}
