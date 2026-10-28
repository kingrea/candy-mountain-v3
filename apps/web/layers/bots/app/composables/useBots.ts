import {
  BOT_FAMILIES,
  PLUGINS_PATH,
  projectBotsPath,
  type BotFamily,
  botSlackConnectionPath,
  type BotListResponse,
  type BotSlackConnection,
  type BotSlackConnectionResponse,
  type PluginInstanceListResponse,
} from '@candy-mountain/shared'

export function useBots() {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => botsDataKey(slug.value),
    () => (slug.value ? $api<BotListResponse>(projectBotsPath(slug.value)) : Promise.resolve({ bots: [] })),
  )

  return {
    bots: computed(() => request.data.value?.bots ?? []),
    data: request.data,
    status: request.status,
    error: request.error,
    refresh: () => request.refresh(),
  }
}

export function useBotsPlugins() {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => botsPluginsDataKey(slug.value),
    () => (slug.value
      ? $api<PluginInstanceListResponse>(PLUGINS_PATH, { query: { project: slug.value } })
      : Promise.resolve({ instances: [] })),
  )

  const instances = computed(() => request.data.value?.instances ?? [])
  const familyReasons = computed(() =>
    Object.fromEntries(BOT_FAMILIES.map(family => [family, botsFamilyPluginReason(instances.value, family)])) as Record<BotFamily, string | null>,
  )

  return {
    instances,
    familyReasons,
    status: request.status,
    error: request.error,
    refresh: () => request.refresh(),
  }
}

export const BOTS_SLACK_POLL_MS = 5000

export function useBotsSlackConnection(slug: MaybeRefOrGetter<string | null>, botId: MaybeRefOrGetter<string>) {
  const { $api } = useNuxtApp()
  const connection = ref<BotSlackConnection | null>(null)
  const failed = ref(false)

  async function refresh() {
    const project = toValue(slug)
    if (!project) return
    try {
      const response = await $api<BotSlackConnectionResponse>(botSlackConnectionPath(project, toValue(botId)))
      connection.value = response.connection
      failed.value = false
    }
    catch {
      failed.value = true
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  const start = () => {
    stop()
    timer = setInterval(refresh, BOTS_SLACK_POLL_MS)
  }
  // A hidden tab stops polling and catches up the moment it is visible again.
  const onVisibility = () => {
    if (document.hidden) return stop()
    void refresh()
    start()
  }

  onMounted(() => {
    if (document.hidden) return
    void refresh()
    start()
  })
  if (import.meta.client) document.addEventListener('visibilitychange', onVisibility)
  onScopeDispose(() => {
    stop()
    if (import.meta.client) document.removeEventListener('visibilitychange', onVisibility)
  })
  watch([() => toValue(slug), () => toValue(botId)], () => {
    connection.value = null
    void refresh()
  })

  return { connection, failed, refresh }
}
