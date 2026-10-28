export function useIssuesSelection(slug: string) {
  const selected = useState<string[]>(`issues:selection:${slug}`, () => [])
  const ids = computed<ReadonlySet<string>>(() => new Set(selected.value))

  function set(next: Iterable<string>) {
    selected.value = [...new Set(next)]
  }

  function toggle(id: string, value = !ids.value.has(id)) {
    if (value === ids.value.has(id)) return
    set(value ? [...selected.value, id] : selected.value.filter(current => current !== id))
  }

  return {
    ids,
    count: computed(() => selected.value.length),
    isSelected: (id: string) => ids.value.has(id),
    toggle,
    select: (more: readonly string[]) => set([...selected.value, ...more]),
    deselect: (less: readonly string[]) => {
      const drop = new Set(less)
      set(selected.value.filter(id => !drop.has(id)))
    },
    set,
    clear: () => set([]),
  }
}

export type IssuesSelection = ReturnType<typeof useIssuesSelection>
