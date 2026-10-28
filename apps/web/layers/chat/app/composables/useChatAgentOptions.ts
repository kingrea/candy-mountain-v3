import { chatAgentOptionsPath, type ChatAgentOptionsResponse } from '@candy-mountain/shared'

/** The agent's model and effort choices; a refused or failed lookup reads as none, so the selectors stay hidden. */
export function useChatAgentOptions(slug: MaybeRefOrGetter<string | null | undefined>, agentId: MaybeRefOrGetter<string | null | undefined>) {
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => chatAgentOptionsDataKey(toValue(slug), toValue(agentId)),
    async () => {
      const current = toValue(slug)
      const id = toValue(agentId)
      if (!current || !id) return null
      try {
        return (await $api<ChatAgentOptionsResponse>(chatAgentOptionsPath(current, id))).options
      }
      catch {
        return null
      }
    },
  )

  const options = computed(() => request.data.value?.agentId === toValue(agentId) ? request.data.value : null)

  return {
    options,
    available: computed(() => chatAgentHasOptions(options.value)),
    status: request.status,
    refresh: () => request.refresh(),
  }
}
