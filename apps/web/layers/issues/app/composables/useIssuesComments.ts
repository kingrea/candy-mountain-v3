import type { IssueComment } from '@candy-mountain/shared'

export function useIssuesComments(slug: MaybeRefOrGetter<string>, issueId: MaybeRefOrGetter<string>) {
  const api = useIssuesApi()
  const { data, status, error, refresh } = useAsyncData(
    () => `issues:comments:${toValue(slug)}:${toValue(issueId)}`,
    () => api.comments(toValue(slug), toValue(issueId)).then(response => response.comments),
    { default: (): IssueComment[] => [], watch: [() => toValue(slug), () => toValue(issueId)] },
  )

  const saving = ref(false)
  const writeError = ref<string | null>(null)

  async function write(action: () => Promise<unknown>): Promise<boolean> {
    saving.value = true
    writeError.value = null
    try {
      await action()
      await refresh()
      // The list's comment count is cached under its own key and would be stale on navigating back.
      await refreshNuxtData(issuesListKey(toValue(slug)))
      return true
    }
    catch (caught) {
      writeError.value = toApiError(caught).message
      return false
    }
    finally {
      saving.value = false
    }
  }

  return {
    comments: data,
    status,
    error,
    refresh,
    saving: readonly(saving),
    writeError,
    add: (text: string) => write(() => api.addComment(toValue(slug), toValue(issueId), text)),
    edit: (commentId: string, text: string) => write(() => api.editComment(toValue(slug), toValue(issueId), commentId, text)),
  }
}
