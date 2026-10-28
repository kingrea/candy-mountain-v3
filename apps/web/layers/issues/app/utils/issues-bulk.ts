import {
  KNOWN_ISSUE_STATUSES,
  MAX_BULK_ISSUE_IDS,
  type BulkIssueChanges,
  type BulkUpdateIssuesRequest,
  type Issue,
} from '@candy-mountain/shared'
import { issuesParentId, type IssuesEpicNode } from './issues-tree'
import { issuesPickerItems, type IssuesPickerItem } from './issue-create'
import { issuesStatusMeta } from './issues-display'

export type IssuesBulkAction = 'add-to-epic' | 'new-epic' | 'remove-from-epic' | 'assign' | 'status'

export type IssuesGroupSelectState = boolean | 'indeterminate'

export function issuesBulkRequest(ids: Iterable<string>, changes: BulkIssueChanges): BulkUpdateIssuesRequest {
  return { ids: [...new Set(ids)], changes }
}

export function issuesBulkTooMany(count: number): boolean {
  return count > MAX_BULK_ISSUE_IDS
}

const plural = (count: number) => `${count} issue${count === 1 ? '' : 's'}`

export function issuesBulkSuccessMessage(action: IssuesBulkAction, count: number, target?: string | null): string {
  switch (action) {
    case 'add-to-epic':
      return `Moved ${plural(count)} to ${target}`
    case 'new-epic':
      return `Created ${target} with ${plural(count)}`
    case 'remove-from-epic':
      return `Removed ${plural(count)} from their epic`
    case 'assign':
      return target ? `Assigned ${plural(count)} to ${target}` : `Unassigned ${plural(count)}`
    case 'status':
      return `Set ${plural(count)} to ${target}`
  }
}

/** Every visible row under a group, nested groups included, which is what its select-all checkbox covers. */
export function issuesGroupIssueIds(issues: readonly Pick<Issue, 'id'>[], epics: readonly IssuesEpicNode<Issue>[]): string[] {
  return [...issues.map(issue => issue.id), ...epics.flatMap(child => issuesGroupIssueIds(child.issues, child.epics))]
}

export function issuesGroupSelectState(ids: readonly string[], selected: ReadonlySet<string>): IssuesGroupSelectState {
  const picked = ids.filter(id => selected.has(id)).length
  if (picked === 0) return false
  return picked === ids.length ? true : 'indeterminate'
}

/** Open epics only, minus the selection itself since bd refuses to make an issue its own parent. */
export function issuesBulkEpicItems(issues: readonly Issue[], selected: ReadonlySet<string>): IssuesPickerItem[] {
  return issuesPickerItems(issues.filter(issue => issue.type === 'epic' && !selected.has(issue.id)))
}

export function issuesBulkStatusItems(): { label: string, value: string, icon: string }[] {
  return KNOWN_ISSUE_STATUSES.map((status) => {
    const meta = issuesStatusMeta(status)
    return { label: meta.label, value: status, icon: meta.icon }
  })
}

export function issuesSelectionHasParent(selected: ReadonlySet<string>, issues: readonly Pick<Issue, 'id' | 'parentId' | 'dependencies'>[]): boolean {
  return issues.some(issue => selected.has(issue.id) && issuesParentId(issue) !== null)
}

/** Selected ids still in the list, or null when none went missing, so callers can skip a pointless write. */
export function issuesPrunedSelection(selected: ReadonlySet<string>, issues: readonly Pick<Issue, 'id'>[]): string[] | null {
  const present = new Set(issues.map(issue => issue.id))
  const kept = [...selected].filter(id => present.has(id))
  return kept.length === selected.size ? null : kept
}
