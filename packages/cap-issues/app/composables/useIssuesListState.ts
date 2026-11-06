import type { IssuesStateFilter } from '#layers/issues/app/utils/issues-list'

/** View state kept per project in useState, so it outlives a refetch and a trip to an issue page and back. */
export function useIssuesListState(slug: string) {
  const showClosed = useState(`issues:view:${slug}:show-closed`, () => false)
  const stateFilter = useState<IssuesStateFilter>(`issues:view:${slug}:state`, () => null)
  const search = useState(`issues:view:${slug}:search`, () => '')
  const collapsed = useState<string[]>(`issues:view:${slug}:collapsed`, () => [])
  const collapsedIds = computed<ReadonlySet<string>>(() => new Set(collapsed.value))

  function setCollapsed(key: string, value: boolean) {
    if (value === collapsedIds.value.has(key)) return
    collapsed.value = value ? [...collapsed.value, key] : collapsed.value.filter(current => current !== key)
  }

  const filters = computed(() => ({ state: stateFilter.value, search: search.value }))

  return { showClosed, stateFilter, search, filters, collapsedIds, setCollapsed }
}

export type IssuesListState = ReturnType<typeof useIssuesListState>
