const REFRESH_DEBOUNCE_MS = 300
const LOST_AFTER_MS = 10_000

function scrollParent(from: Element | null): HTMLElement | null {
  for (let node = from?.parentElement ?? null; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return node
  }
  return null
}

/** Refetches the list on daemon change notices, keeping the scroll position, and refetches again after a reconnect. */
export function useIssuesLiveRefresh(slug: MaybeRefOrGetter<string | null | undefined>, refresh: () => Promise<unknown>) {
  const refreshing = ref(false)
  const lost = ref(false)

  const coalescer = issuesCreateRefreshCoalescer({
    delayMs: REFRESH_DEBOUNCE_MS,
    onBusy: busy => (refreshing.value = busy),
    async run() {
      const container = scrollParent(document.querySelector('[data-testid="issues-list"]'))
      const top = container?.scrollTop ?? 0
      await refresh()
      await nextTick()
      if (container) container.scrollTop = top
    },
  })

  const { connected } = useIssuesEvents(slug, () => coalescer.trigger())

  let lostTimer: ReturnType<typeof setTimeout> | null = null
  let wasConnected = false
  watch(connected, (value) => {
    if (lostTimer) clearTimeout(lostTimer)
    lostTimer = null
    if (value) {
      lost.value = false
      // EventSource reconnects silently, so changes made while it was down never arrive as events
      if (wasConnected) coalescer.trigger()
      wasConnected = true
    }
    else {
      lostTimer = setTimeout(() => (lost.value = true), LOST_AFTER_MS)
    }
  })

  onScopeDispose(() => {
    coalescer.cancel()
    if (lostTimer) clearTimeout(lostTimer)
  })

  return { refreshing: readonly(refreshing), lost: readonly(lost), connected }
}
