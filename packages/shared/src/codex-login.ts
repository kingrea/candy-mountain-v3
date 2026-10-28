/** Action names served at `/plugins/:id/<name>` for a `codex` instance. */
export const CODEX_LOGIN_ACTIONS = {
  start: 'start-login',
  status: 'login-status',
  revoke: 'revoke',
} as const

export const CODEX_LOGIN_ATTEMPT_STATUSES = ['starting', 'waiting', 'succeeded', 'failed', 'expired'] as const
export type CodexLoginAttemptStatus = (typeof CODEX_LOGIN_ATTEMPT_STATUSES)[number]

export interface CodexLoginAttempt {
  attemptId: string
  status: CodexLoginAttemptStatus
  /** Set only while the attempt is waiting for the browser. */
  verificationUrl: string | null
  /** The one-time code to enter at the verification URL; set only while waiting. */
  userCode: string | null
  startedAt: string
  expiresAt: string
  endedAt: string | null
  /** Why a failed or expired attempt ended. */
  failure: string | null
}

export interface CodexLoginStatusResponse {
  /** The current or most recent attempt since the daemon started; null when there is none. */
  attempt: CodexLoginAttempt | null
}

export interface CodexRevokeResponse {
  /** False when there was no Codex home to delete. */
  removed: boolean
}
