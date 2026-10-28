import { SESSION_EVENT_NAME, SESSION_STATUS_EVENT_NAME, sessionEventsPath, type AgentSessionEvent } from '@candy-mountain/shared'

/**
 * Logs of a thread's earlier sessions, loaded once each. A replaced session never runs again, so its log is final.
 * Client only.
 */
export function useChatSessionHistory(slug: MaybeRefOrGetter<string | null | undefined>, sessionIds: MaybeRefOrGetter<readonly string[]>) {
  const logs = shallowRef<Record<string, readonly AgentSessionEvent[]>>({})
  const sources = new Map<string, EventSource>()

  function remember(sessionId: string, events: readonly AgentSessionEvent[]) {
    logs.value = { ...logs.value, [sessionId]: [...events] }
  }

  function load(current: string, sessionId: string) {
    const collected: AgentSessionEvent[] = []
    const stream = new EventSource(`/api${sessionEventsPath(current, sessionId)}`)
    const finish = () => {
      stream.close()
      sources.delete(sessionId)
      if (!(sessionId in logs.value)) remember(sessionId, collected)
    }
    stream.addEventListener(SESSION_EVENT_NAME, (message: MessageEvent<string>) => {
      collected.push(JSON.parse(message.data) as AgentSessionEvent)
    })
    // The stream sends the status right after replaying the log, which is all an ended session has to give.
    stream.addEventListener(SESSION_STATUS_EVENT_NAME, finish)
    stream.onerror = finish
    sources.set(sessionId, stream)
  }

  function sync() {
    const current = toValue(slug)
    if (!current) return
    for (const id of toValue(sessionIds)) {
      if (!(id in logs.value) && !sources.has(id)) load(current, id)
    }
  }

  function close() {
    for (const stream of sources.values()) stream.close()
    sources.clear()
  }

  onMounted(() => {
    watch(() => toValue(slug), () => {
      close()
      logs.value = {}
    })
    watch(() => [toValue(slug), ...toValue(sessionIds)], sync, { immediate: true })
  })
  onScopeDispose(close)

  return { logs: shallowReadonly(logs), remember }
}
