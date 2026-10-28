import type { AgentSessionStatus } from '@candy-mountain/shared'

export const CHAT_WORKING_STATUSES: readonly AgentSessionStatus[] = ['queued', 'starting', 'prompting']

export function chatIsWorking(status: AgentSessionStatus | null | undefined): boolean {
  return status !== null && status !== undefined && CHAT_WORKING_STATUSES.includes(status)
}
