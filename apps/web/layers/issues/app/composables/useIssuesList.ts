import type { Issue } from '@candy-mountain/shared'

export function useIssuesList(slug: string) {
  const api = useIssuesApi()
  const { data, status, error, refresh } = useAsyncData(
    issuesListKey(slug),
    () => api.list(slug).then(response => response.issues),
    { default: (): Issue[] => [] },
  )
  return { issues: data, status, error, refresh }
}
