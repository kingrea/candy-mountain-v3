import {
  projectThreadPath,
  projectThreadsPath,
  threadCancelPath,
  threadPromptPath,
  threadReadPath,
  type ChatThread,
  type ChatThreadListResponse,
  type ChatThreadPromptResponse,
  type ChatThreadResponse,
  type CreateChatThreadRequest,
  type UpdateChatThreadRequest,
} from '@candy-mountain/shared'

/** One shared fetch per project, narrowed per agent; the unfiltered list is refused until the registry lists an agent. */
export function useChatThreads(slug: MaybeRefOrGetter<string | null | undefined>, agentId?: MaybeRefOrGetter<string | null | undefined>) {
  const { $api } = useNuxtApp()
  const { registry, loaded } = useProjectRegistry()

  const enabled = computed(() => Boolean(toValue(slug)) && (registry.value?.agents.length ?? 0) > 0)

  const request = useAsyncData(
    () => chatThreadsDataKey(toValue(slug)),
    async () => {
      await loaded
      const current = toValue(slug)
      return current && enabled.value ? $api<ChatThreadListResponse>(projectThreadsPath(current)) : { threads: [] }
    },
    { watch: [enabled] },
  )

  const threads = computed(() => {
    const projectId = registry.value?.project.id
    const wanted = toValue(agentId)
    return (request.data.value?.threads ?? [])
      .filter(thread => thread.projectId === projectId && (!wanted || thread.agentId === wanted))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
  })

  function path(): string {
    const current = toValue(slug)
    if (!current) throw new Error('No project selected')
    return current
  }

  function replace(thread: ChatThread) {
    const list = request.data.value?.threads ?? []
    const index = list.findIndex(candidate => candidate.id === thread.id)
    request.data.value = { threads: index === -1 ? [thread, ...list] : list.with(index, thread) }
  }

  async function create(body: CreateChatThreadRequest): Promise<ChatThreadResponse> {
    const created = await $api<ChatThreadResponse>(projectThreadsPath(path()), { method: 'POST', body })
    replace(created.thread)
    return created
  }

  async function prompt(threadId: string, text: string): Promise<ChatThreadPromptResponse> {
    const response = await $api<ChatThreadPromptResponse>(threadPromptPath(path(), threadId), { method: 'POST', body: { text } })
    replace(response.thread)
    return response
  }

  async function cancel(threadId: string): Promise<ChatThreadPromptResponse> {
    const response = await $api<ChatThreadPromptResponse>(threadCancelPath(path(), threadId), { method: 'POST' })
    replace(response.thread)
    return response
  }

  async function markRead(threadId: string): Promise<ChatThread> {
    const response = await $api<{ thread: ChatThread }>(threadReadPath(path(), threadId), { method: 'POST' })
    replace(response.thread)
    return response.thread
  }

  /** A model or effort change starts a fresh session; refresh the thread afterwards so the panel follows it. */
  async function update(threadId: string, body: UpdateChatThreadRequest): Promise<ChatThreadResponse> {
    const response = await $api<ChatThreadResponse>(projectThreadPath(path(), threadId), { method: 'PATCH', body })
    replace(response.thread)
    return response
  }

  return {
    threads,
    enabled,
    status: request.status,
    error: request.error,
    refresh: () => request.refresh(),
    create,
    prompt,
    cancel,
    markRead,
    update,
  }
}

/** One thread with its current session; the session id is what the transcript stream follows. */
export function useChatThread(slug: MaybeRefOrGetter<string | null | undefined>, threadId: MaybeRefOrGetter<string | null | undefined>) {
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => chatThreadDataKey(toValue(slug), toValue(threadId)),
    () => {
      const current = toValue(slug)
      const id = toValue(threadId)
      return current && id ? $api<ChatThreadResponse>(projectThreadPath(current, id)) : Promise.resolve(null)
    },
  )

  const matches = computed(() => request.data.value?.thread.id === toValue(threadId) ? request.data.value : null)

  return {
    /** The whole response, for a contributing layer that reads its own fields of it. */
    response: matches,
    thread: computed(() => matches.value?.thread ?? null),
    session: computed(() => matches.value?.session ?? null),
    sessions: computed(() => matches.value?.sessions ?? []),
    status: request.status,
    error: request.error,
    refresh: () => request.refresh(),
  }
}
