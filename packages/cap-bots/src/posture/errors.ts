export type PostureErrorCode =
  | 'invalid_input'
  | 'bypass'
  | 'persona_unreadable'
  | 'persona_name_mismatch'
  | 'persona_widens'
  | 'checkout_settings_unreadable'
  | 'checkout_settings_widens'
  | 'checkout_agent_unreadable'
  | 'checkout_agent_widens'
  | 'widened'

export class PostureError extends Error {
  readonly code: PostureErrorCode

  constructor(code: PostureErrorCode, message: string) {
    super(message)
    this.name = 'PostureError'
    this.code = code
  }
}
