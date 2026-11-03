import { SESSION_PROMPT_MAX_LENGTH, type SessionPromptRequest } from '@candy-mountain/platform-sdk'
import { SessionError } from './session-errors'

export function parsePrompt(body: Record<string, unknown>): SessionPromptRequest {
  const text = body.text
  if (typeof text !== 'string' || text.trim() === '') throw new SessionError('invalid_request', 'text must be a non-empty string')
  if (text.length > SESSION_PROMPT_MAX_LENGTH) throw new SessionError('invalid_request', `text must be at most ${SESSION_PROMPT_MAX_LENGTH} characters`)
  return { text }
}
