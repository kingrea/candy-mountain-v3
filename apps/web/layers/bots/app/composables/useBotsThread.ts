import { threadClosePath, type ChatThreadCloseResponse } from '@candy-mountain/shared'

/** Where a bot thread's current session works, read from the thread the chat panel already fetches. */
export function useBotsThread(slug: MaybeRefOrGetter<string | null | undefined>, threadId: MaybeRefOrGetter<string | null | undefined>) {
  const { $api } = useNuxtApp()
  const current = useChatThread(slug, threadId)

  /** The worktree is released unless it holds unpushed work, which the response reports. */
  async function close(): Promise<ChatThreadCloseResponse> {
    const project = toValue(slug)
    const id = toValue(threadId)
    if (!project || !id) throw new Error('No thread selected')
    return $api<ChatThreadCloseResponse>(threadClosePath(project, id), { method: 'POST' })
  }

  return {
    bot: computed(() => current.response.value?.bot ?? null),
    close,
  }
}
