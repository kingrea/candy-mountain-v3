export const ISSUES_SLIDEOVER_QUERY = 'issue'
export const ISSUES_SLIDEOVER_HISTORY_LIMIT = 50

/** The open issue lives in the `?issue=` query so a reload reopens it; the back stack lives in useState per project. */
export function useIssuesSlideover(slug: MaybeRefOrGetter<string | null | undefined>) {
  const route = useRoute()
  const router = useRouter()
  const stacks = useState<Record<string, string[]>>('issues:slideover:history', () => ({}))

  const issueId = computed(() => {
    const value = route.query[ISSUES_SLIDEOVER_QUERY]
    return typeof value === 'string' && value ? value : null
  })

  const history = computed<readonly string[]>(() => stacks.value[toValue(slug) ?? ''] ?? [])

  function setHistory(next: string[]) {
    const current = toValue(slug)
    if (current) stacks.value = { ...stacks.value, [current]: next.slice(-ISSUES_SLIDEOVER_HISTORY_LIMIT) }
  }

  function show(id: string | null) {
    const { [ISSUES_SLIDEOVER_QUERY]: _previous, ...rest } = route.query
    return router.replace({ query: id ? { ...rest, [ISSUES_SLIDEOVER_QUERY]: id } : rest })
  }

  function open(id: string) {
    setHistory([])
    return show(id)
  }

  function push(id: string) {
    const current = issueId.value
    if (current === id) return
    if (current) setHistory([...history.value, current])
    return show(id)
  }

  function back() {
    const previous = history.value.at(-1)
    if (!previous) return
    setHistory(history.value.slice(0, -1))
    return show(previous)
  }

  function close() {
    setHistory([])
    return show(null)
  }

  return {
    issueId,
    history,
    canGoBack: computed(() => history.value.length > 0),
    open,
    push,
    back,
    close,
  }
}

export type IssuesSlideover = ReturnType<typeof useIssuesSlideover>
