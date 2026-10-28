import type { BulkIssueChanges, BulkUpdateIssuesResponse } from '@candy-mountain/shared'
import type { IssuesBulkAction } from '#layers/issues/app/utils/issues-bulk'

export function useIssuesBulk(slug: string) {
  const api = useIssuesApi()
  const selection = useIssuesSelection(slug)
  const toast = useToast()
  const pending = ref<IssuesBulkAction | null>(null)

  function reportMissing(response: BulkUpdateIssuesResponse) {
    if (response.missingIds.length === 0) return
    toast.add({
      title: `${response.missingIds.length} issue${response.missingIds.length === 1 ? ' was' : 's were'} not found`,
      description: response.missingIds.join(', '),
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
    })
  }

  async function run(action: IssuesBulkAction, work: (ids: string[]) => Promise<{ response: BulkUpdateIssuesResponse, target?: string | null }>): Promise<boolean> {
    if (pending.value) return false
    pending.value = action
    let ok = false
    try {
      const { response, target } = await work([...selection.ids.value])
      toast.add({ title: issuesBulkSuccessMessage(action, response.updatedIds.length, target), color: 'success', icon: 'i-lucide-check' })
      reportMissing(response)
      ok = true
    }
    catch (error) {
      toast.add({ title: 'Bulk update failed', description: toApiError(error).message, color: 'error', icon: 'i-lucide-circle-x' })
    }
    // A refused bulk update can still have changed earlier ids, so the list is refetched either way.
    await refreshNuxtData(issuesListKey(slug))
    if (ok) selection.clear()
    pending.value = null
    return ok
  }

  const apply = (action: Exclude<IssuesBulkAction, 'new-epic'>, changes: BulkIssueChanges, target?: string | null) =>
    run(action, async ids => ({ response: await api.bulkUpdate(slug, issuesBulkRequest(ids, changes)), target }))

  const createEpic = (title: string) =>
    run('new-epic', async (ids) => {
      const { issue } = await api.create(slug, { title: title.trim(), type: 'epic' })
      try {
        return { response: await api.bulkUpdate(slug, issuesBulkRequest(ids, { parentId: issue.id })), target: issue.id }
      }
      catch (error) {
        throw Object.assign(new Error(`Created ${issue.id} but could not move the issues into it: ${toApiError(error).message}`), { cause: error })
      }
    })

  return { pending: readonly(pending), apply, createEpic }
}
