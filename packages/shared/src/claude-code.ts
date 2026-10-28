export const CLAUDE_CODE_AUTH_MODES = ['login', 'token'] as const
export type ClaudeCodeAuthMode = (typeof CLAUDE_CODE_AUTH_MODES)[number]

/** Instance actions of the claude-code plugin type, served at `/plugins/:id/<action>`. */
export const CLAUDE_CODE_ACTIONS = {
  startLogin: 'start-login',
  submitCode: 'submit-code',
  revoke: 'revoke',
} as const

export const CLAUDE_CODE_LOGIN_ATTEMPT_TTL_MS = 10 * 60_000

export interface ClaudeCodeStartLoginResponse {
  attemptId: string
  /** The sign-in link to open; the browser ends by showing a code to paste back. */
  url: string
  expiresAt: string
}

export interface ClaudeCodeSubmitCodeRequest {
  attemptId: string
  code: string
}

export type ClaudeCodeSubmitCodeResponse =
  | { attemptId: string, status: 'logged_in' }
  | { attemptId: string, status: 'failed', reason: string }

export interface ClaudeCodeRevokeResponse {
  /** False when there was no config directory to delete. */
  directoryRemoved: boolean
  /** False when no token was stored. */
  tokenCleared: boolean
}

export const CLAUDE_CODE_ERROR_CODES = [
  'claude_code_login_failed',
  'claude_code_attempt_not_found',
  'claude_code_attempt_not_waiting',
  'claude_code_invalid_code',
] as const
export type ClaudeCodeErrorCode = (typeof CLAUDE_CODE_ERROR_CODES)[number]
