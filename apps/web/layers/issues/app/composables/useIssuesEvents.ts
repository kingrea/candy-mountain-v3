import { ISSUE_CHANGED_EVENT, projectIssueEventsPath, type IssueChangedEvent } from '@candy-mountain/shared'

/** Opens on mount, never during SSR, and closes with the caller's scope. */
export function useIssuesEvents(slug: MaybeRefOrGetter<string | null | undefined>, onChanged: (event: IssueChangedEvent) => void) {
  const connected = ref(false)
  let source: EventSource | null = null

  function close() {
    source?.close()
    source = null
    connected.value = false
  }

  function open(current: string | null | undefined) {
    close()
    if (!current) return
    // EventSource cannot use $api, so the proxy prefix that $api's baseURL carries is spelled out here.
    const stream = new EventSource(`/api${projectIssueEventsPath(current)}`)
    stream.onopen = () => {
      connected.value = true
    }
    stream.onerror = () => {
      connected.value = false
    }
    stream.addEventListener(ISSUE_CHANGED_EVENT, (message: MessageEvent<string>) => {
      onChanged(JSON.parse(message.data) as IssueChangedEvent)
    })
    source = stream
  }

  onMounted(() => {
    watch(() => toValue(slug), open, { immediate: true })
  })
  onScopeDispose(close)

  return { connected: readonly(connected), close }
}
