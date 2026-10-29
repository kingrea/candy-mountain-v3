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

/** Type-level actions of the claude-code plugin type, served at `/plugin-types/claude-code/<action>` before an instance exists. */
export const CLAUDE_CODE_TYPE_ACTIONS = {
  executable: 'executable',
} as const

/** The one-line install for the stock claude executable, shown when none is found. */
export const CLAUDE_INSTALL_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'

/**
 * Result of `GET /plugin-types/claude-code/executable[?path=...]`: without `path` the daemon looks for `claude`
 * on its PATH and in the usual install directories; with one it checks that file. A found executable was run
 * with `--version` to prove it starts.
 */
export type ClaudeExecutableResponse =
  | {
    found: true
    /** Absolute path of the executable. */
    path: string
    /** True when PATH resolves to it, so the plugin's claudePath may stay blank. */
    onPath: boolean
    /** The version `claude --version` printed, when it was recognised. */
    version?: string
  }
  | {
    found: false
    /** A fixed sentence on what went wrong; never CLI output. */
    reason: string
    /** The directories or file that were checked. */
    searched: string[]
  }
