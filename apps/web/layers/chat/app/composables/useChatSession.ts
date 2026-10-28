import {
  SESSION_EVENT_NAME,
  SESSION_STATUS_EVENT_NAME,
  sessionEventsPath,
  type AgentSessionEvent,
  type AgentSessionStatus,
  type SessionStatusEvent,
} from '@candy-mountain/shared'

const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 15_000

/** Follows a session's log over SSE, replaying from the last seq seen on open and after every drop. Client only. */
export function useChatSession(slug: MaybeRefOrGetter<string | null | undefined>, sessionId: MaybeRefOrGetter<string | null | undefined>) {
  const events = ref<AgentSessionEvent[]>([])
  const status = ref<AgentSessionStatus | null>(null)
  const connected = ref(false)
  let source: EventSource | null = null
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let delay = RECONNECT_MIN_MS
  let lastSeq = 0

  function close() {
    clearTimeout(reconnect)
    source?.close()
    source = null
    connected.value = false
  }

  function open() {
    close()
    const current = toValue(slug)
    const id = toValue(sessionId)
    if (!current || !id) return
    // EventSource cannot use $api, so the proxy prefix that $api's baseURL carries is spelled out here.
    const stream = new EventSource(`/api${sessionEventsPath(current, id, lastSeq)}`)
    stream.onopen = () => {
      connected.value = true
      delay = RECONNECT_MIN_MS
    }
    stream.onerror = () => {
      // The browser's own retry would replay from the original `after`; reopening from the last seq is cheaper.
      close()
      reconnect = setTimeout(open, delay)
      delay = Math.min(delay * 2, RECONNECT_MAX_MS)
    }
    stream.addEventListener(SESSION_EVENT_NAME, (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AgentSessionEvent
      if (event.seq <= lastSeq) return
      lastSeq = event.seq
      events.value.push(event)
    })
    stream.addEventListener(SESSION_STATUS_EVENT_NAME, (message: MessageEvent<string>) => {
      status.value = (JSON.parse(message.data) as SessionStatusEvent).status
    })
    source = stream
  }

  function reset() {
    events.value = []
    status.value = null
    lastSeq = 0
    delay = RECONNECT_MIN_MS
    open()
  }

  onMounted(() => {
    watch(() => [toValue(slug), toValue(sessionId)], reset, { immediate: true })
  })
  onScopeDispose(close)

  return {
    events: shallowReadonly(events),
    status: readonly(status),
    connected: readonly(connected),
    working: computed(() => chatIsWorking(status.value)),
    close,
  }
}
