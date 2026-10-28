import {
  projectAssigneesPath,
  type AddAssigneeRequest,
  type AddAssigneeResponse,
  type ProjectAssigneesResponse,
} from '@candy-mountain/shared'

export function useIssuesAssignees(slug: MaybeRefOrGetter<string>) {
  const { $api } = useNuxtApp()
  const names = ref<string[]>([])
  const pending = ref(false)

  async function refresh() {
    pending.value = true
    try {
      const { assignees } = await $api<ProjectAssigneesResponse>(projectAssigneesPath(toValue(slug)))
      names.value = assignees.map(assignee => assignee.name)
    }
    finally {
      pending.value = false
    }
  }

  /** Resolves to the stored name, which keeps the existing spelling when the new one differs only by case. */
  async function add(name: string): Promise<string> {
    const body: AddAssigneeRequest = { name }
    const { assignee } = await $api<AddAssigneeResponse>(projectAssigneesPath(toValue(slug)), { method: 'POST', body })
    if (!names.value.includes(assignee.name)) names.value = [...names.value, assignee.name].sort((a, b) => a.localeCompare(b))
    return assignee.name
  }

  watch(() => toValue(slug), refresh, { immediate: true })

  return { names: readonly(names), pending: readonly(pending), refresh, add }
}
