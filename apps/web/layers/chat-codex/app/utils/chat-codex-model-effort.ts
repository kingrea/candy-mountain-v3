import type { ChatAgentOptions, ChatOption, ChatThreadSession } from '@candy-mountain/shared'

/** Select items cannot carry null, so the agent's own default travels as this value. */
export const CHAT_CODEX_OPTION_DEFAULT = 'agent-default'

export interface ChatCodexModelEffortChoice {
  model: string | null
  effort: string | null
}

export interface ChatCodexOptionItem {
  label: string
  value: string
}

export const chatCodexOptionsDataKey = (slug: string | null | undefined, agentId: string | null | undefined) => `chat-codex-options:${slug ?? ''}:${agentId ?? ''}`

export function chatCodexOptionItems(options: readonly ChatOption[], defaultLabel: string): ChatCodexOptionItem[] {
  return [{ label: defaultLabel, value: CHAT_CODEX_OPTION_DEFAULT }, ...options.map(option => ({ label: option.label, value: option.value }))]
}

export const chatCodexOptionValue = (value: string | null): string => value ?? CHAT_CODEX_OPTION_DEFAULT
export const chatCodexOptionChoice = (value: string): string | null => (value === CHAT_CODEX_OPTION_DEFAULT ? null : value)

export const chatCodexHasOptions = (options: ChatAgentOptions | null | undefined): boolean =>
  Boolean(options && (options.models.length || options.efforts.length))

function optionLabel(options: readonly ChatOption[] | undefined, value: string | null): string {
  if (value === null) return 'default'
  return options?.find(option => option.value === value)?.label ?? value
}

/** What changed between two consecutive sessions of a thread, worded for the transcript divider. */
export function chatCodexSessionDivider(previous: ChatThreadSession, next: ChatThreadSession, options?: ChatAgentOptions | null): string {
  const changes: string[] = []
  if (previous.model !== next.model) changes.push(`model ${optionLabel(options?.models, next.model)}`)
  if (previous.effort !== next.effort) changes.push(`effort ${optionLabel(options?.efforts, next.effort)}`)
  return changes.length ? `New session with ${changes.join(' and ')}` : 'New session'
}

/** Divider text keyed by session id, for every session that replaced an earlier one. */
export function chatCodexSessionDividers(sessions: readonly ChatThreadSession[], options?: ChatAgentOptions | null): Record<string, string> {
  const dividers: Record<string, string> = {}
  sessions.forEach((session, index) => {
    if (index > 0) dividers[session.sessionId] = chatCodexSessionDivider(sessions[index - 1]!, session, options)
  })
  return dividers
}
