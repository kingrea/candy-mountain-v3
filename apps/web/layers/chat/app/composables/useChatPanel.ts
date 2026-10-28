import { projectThreadPath, type ChatThreadResponse } from '@candy-mountain/shared'

export interface ChatPanelState {
  /** The project the state belongs to; a project switch starts the rail afresh. */
  slug: string | null
  entryId: string | null
  threadId: string | null
  /** A thread not yet created: the first prompt creates it. */
  draft: boolean
}

const closed = (): ChatPanelState => ({ slug: null, entryId: null, threadId: null, draft: false })

/** Shared panel state; a shown thread is mirrored into `?thread=` so a reload lands on it again. */
export function useChatPanel() {
  const state = useState<ChatPanelState>('chat-panel', closed)
  const route = useRoute()
  const router = useRouter()
  const { slug } = useSelectedProject()

  const open = computed(() => state.value.entryId !== null && state.value.slug === slug.value)

  function syncQuery(threadId: string | null) {
    const current = route.query[CHAT_THREAD_QUERY]
    if ((typeof current === 'string' ? current : null) === threadId) return
    const { [CHAT_THREAD_QUERY]: _dropped, ...rest } = route.query
    void router.replace({ query: threadId ? { ...rest, [CHAT_THREAD_QUERY]: threadId } : rest })
  }

  function openEntry(entryId: string) {
    state.value = { slug: slug.value, entryId, threadId: null, draft: false }
    syncQuery(null)
  }

  function startThread(entryId: string) {
    state.value = { slug: slug.value, entryId, threadId: null, draft: true }
    syncQuery(null)
  }

  function showThread(entryId: string, threadId: string) {
    state.value = { slug: slug.value, entryId, threadId, draft: false }
    syncQuery(threadId)
  }

  function showList() {
    state.value = { ...state.value, threadId: null, draft: false }
    syncQuery(null)
  }

  function close() {
    state.value = closed()
    syncQuery(null)
  }

  return { state, open, openEntry, startThread, showThread, showList, close }
}

/** Opens the thread named by `?thread=` and drops stale state when the project changes. Mounted once, by the dock. */
export function useChatDeepLink() {
  const { state, showThread } = useChatPanel()
  const { slug } = useSelectedProject()
  const route = useRoute()
  const { $api } = useNuxtApp()

  watch(slug, (current) => {
    if (state.value.slug !== current) state.value = closed()
  })

  onMounted(() => {
    watch(() => route.query[CHAT_THREAD_QUERY], async (value) => {
      const current = slug.value
      if (typeof value !== 'string' || !current || (state.value.threadId === value && state.value.slug === current)) return
      try {
        const { thread } = await $api<ChatThreadResponse>(projectThreadPath(current, value))
        if (slug.value === current) showThread(thread.agentId, thread.id)
      }
      catch {
        // An unknown thread or an agent no longer chattable: the page stays usable without the panel.
      }
    }, { immediate: true })
  })
}

export function useChatRailEntries() {
  const { registry } = useProjectRegistry()
  const { slug } = useSelectedProject()
  const threads = useChatThreads(slug)

  const agents = computed(() => chatAgentRailEntries(registry.value?.agents ?? [], threads.threads.value))
  const extra = chatRailSources().map(source => ({ order: source.order ?? 100, entries: source.use() }))
  const sources = [{ order: 0, entries: agents }, ...extra].sort((a, b) => a.order - b.order)
  const entries = computed(() => sources.flatMap(source => toValue(source.entries)))

  // Flags change server-side while the panel is closed (a turn ends, another tab reads), so the rail polls lightly.
  onMounted(() => {
    const timer = setInterval(() => {
      if (threads.enabled.value && document.visibilityState === 'visible') void threads.refresh()
    }, CHAT_THREADS_POLL_MS)
    onScopeDispose(() => clearInterval(timer))
  })

  return { entries, threads }
}
