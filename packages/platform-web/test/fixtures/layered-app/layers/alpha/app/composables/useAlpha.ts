import { useChatThread } from '#layers/chat/app/composables/useChatThread'

export const ALPHA_LIMIT = 5

export interface AlphaRow {
  id: string
}

export function useAlpha(): AlphaRow[] {
  return Array.from({ length: useChatThread() }, (_, i) => ({ id: String(i) }))
}
