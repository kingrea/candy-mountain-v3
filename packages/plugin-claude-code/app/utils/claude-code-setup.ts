import type { ClaudeCodeAuthMode, ClaudeExecutableResponse } from '../../src/wire'

export type ClaudeCodeExecutableState =
  | { status: 'checking' }
  | { status: 'checked', result: ClaudeExecutableResponse, custom: boolean }
  | { status: 'error', message: string }

/**
 * The claudePath to store: blank when PATH resolves claude itself, the found path when it sits in an install
 * directory off PATH, and a verified custom path as typed. Null means "do not save yet" (nothing verified).
 */
export function claudeCodePathToSave(state: ClaudeCodeExecutableState | null): string | null {
  if (!state || state.status !== 'checked' || !state.result.found) return null
  return state.result.onPath ? '' : state.result.path
}

export interface ClaudeCodeExecutableSummary {
  title: string
  detail?: string
}

export function claudeCodeExecutableSummary(result: ClaudeExecutableResponse): ClaudeCodeExecutableSummary {
  if (result.found) {
    const version = result.version ? `claude ${result.version}` : 'claude'
    return { title: `Found ${version}`, detail: result.path }
  }
  return { title: 'The claude executable could not be found', detail: result.reason }
}

export const CLAUDE_CODE_AUTH_MODE_OPTIONS: ReadonlyArray<{ value: ClaudeCodeAuthMode, label: string, icon: string, description: string }> = [
  { value: 'login', label: 'Browser login', icon: 'i-lucide-globe', description: 'Sign in to Claude in your browser and paste the code back here.' },
  { value: 'token', label: 'Long-lived token', icon: 'i-lucide-key-round', description: 'Paste a token from `claude setup-token`, for daemons that cannot open a browser.' },
]

/** Login mode needs nothing typed; token mode needs a token unless one is already stored. */
export function claudeCodeSetupReady(mode: ClaudeCodeAuthMode, token: string, tokenStored: boolean): boolean {
  return mode === 'login' || token.trim() !== '' || tokenStored
}
