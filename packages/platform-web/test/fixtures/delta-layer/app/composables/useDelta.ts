import { useChatThread } from '#layers/chat/app/composables/useChatThread'

export const DELTA_LIMIT = 4

export function useDelta(): string[] {
  return Array.from({ length: useChatThread() }, (_, i) => String(i))
}
