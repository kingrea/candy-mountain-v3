import type { IssueDetail } from '@candy-mountain/shared'
import type { IssuesEditDraft, IssuesEditField, IssuesEditableValues } from '#layers/issues/app/utils/issues-edit'

export type IssuesEditTarget = IssuesEditField | 'close'

export interface IssuesEditFailure {
  target: IssuesEditTarget
  error: ApiErrorInfo
}

export interface IssuesEditOptions {
  /** Receives the issue as the tracker reads it back after a successful write. */
  onSaved?: (issue: IssueDetail) => void | Promise<void>
}

export function useIssuesEdit(
  slug: MaybeRefOrGetter<string>,
  issueId: MaybeRefOrGetter<string>,
  options: IssuesEditOptions = {},
) {
  const api = useIssuesApi()
  const saving = ref<Partial<Record<IssuesEditTarget, boolean>>>({})
  const failure = ref<IssuesEditFailure | null>(null)

  function isSaving(target: IssuesEditTarget): boolean {
    return saving.value[target] === true
  }

  function errorFor(target: IssuesEditTarget): ApiErrorInfo | null {
    return failure.value?.target === target ? failure.value.error : null
  }

  function clearError(target?: IssuesEditTarget) {
    if (!target || failure.value?.target === target) failure.value = null
  }

  async function run(target: IssuesEditTarget, write: () => Promise<{ issue: IssueDetail }>): Promise<boolean> {
    saving.value = { ...saving.value, [target]: true }
    clearError(target)
    try {
      const { issue } = await write()
      await options.onSaved?.(issue)
      return true
    }
    catch (error) {
      failure.value = { target, error: toApiError(error) }
      return false
    }
    finally {
      saving.value = { ...saving.value, [target]: false }
    }
  }

  /** Resolves true when the write landed or nothing changed; on false the caller keeps the draft and the old value. */
  async function save(target: IssuesEditField, current: IssuesEditableValues, draft: IssuesEditDraft): Promise<boolean> {
    const changes = issuesEditChanges(current, draft)
    if (Object.keys(changes).length === 0) {
      clearError(target)
      return true
    }
    const problem = issuesEditProblem(changes)
    if (problem) {
      failure.value = { target, error: { code: 'invalid_request', message: problem } }
      return false
    }
    return run(target, () => api.update(toValue(slug), toValue(issueId), changes))
  }

  async function close(reason: string, force = false): Promise<boolean> {
    const trimmed = reason.trim()
    return run('close', () => api.close(toValue(slug), toValue(issueId), { ...(trimmed && { reason: trimmed }), ...(force && { force }) }))
  }

  return { saving, failure, isSaving, errorFor, clearError, save, close }
}
