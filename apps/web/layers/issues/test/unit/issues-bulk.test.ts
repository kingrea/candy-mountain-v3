import type { Issue } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  issuesBulkEpicItems,
  issuesBulkRequest,
  issuesBulkStatusItems,
  issuesBulkSuccessMessage,
  issuesBulkTooMany,
  issuesGroupIssueIds,
  issuesGroupSelectState,
  issuesPrunedSelection,
  issuesSelectionHasParent,
} from '../../app/utils/issues-bulk'
import type { IssuesEpicNode } from '../../app/utils/issues-tree'

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Title ${id}`,
    type: 'task',
    status: 'open',
    priority: 2,
    parentId: null,
    dependencies: [],
    labels: [],
    assignee: null,
    commentCount: 0,
    ready: true,
    ...overrides,
  } as Issue
}

function node(epic: Issue, issues: Issue[], epics: IssuesEpicNode[] = []): IssuesEpicNode {
  return { epic, issues, epics, openCount: 0, totalCount: 0 }
}

describe('issuesBulkRequest', () => {
  it('sends every id once with the changes untouched', () => {
    expect(issuesBulkRequest(new Set(['a', 'b']), { parentId: null })).toEqual({ ids: ['a', 'b'], changes: { parentId: null } })
    expect(issuesBulkRequest(['a', 'b', 'a'], { assignee: 'Ana', status: 'in_progress' }).ids).toEqual(['a', 'b'])
  })
})

describe('issuesBulkTooMany', () => {
  it('allows exactly the daemon limit and refuses one more', () => {
    expect(issuesBulkTooMany(200)).toBe(false)
    expect(issuesBulkTooMany(201)).toBe(true)
  })
})

describe('issuesBulkSuccessMessage', () => {
  it('names the action, the count and the target', () => {
    expect(issuesBulkSuccessMessage('add-to-epic', 5, 'cm-1')).toBe('Moved 5 issues to cm-1')
    expect(issuesBulkSuccessMessage('new-epic', 1, 'cm-9')).toBe('Created cm-9 with 1 issue')
    expect(issuesBulkSuccessMessage('remove-from-epic', 2)).toBe('Removed 2 issues from their epic')
    expect(issuesBulkSuccessMessage('assign', 3, 'Ana')).toBe('Assigned 3 issues to Ana')
    expect(issuesBulkSuccessMessage('assign', 3, null)).toBe('Unassigned 3 issues')
    expect(issuesBulkSuccessMessage('status', 4, 'In progress')).toBe('Set 4 issues to In progress')
  })
})

describe('issuesGroupIssueIds', () => {
  it('collects rows from the group and every nested group in display order', () => {
    const child = node(issue('e.2', { type: 'epic' }), [issue('e.2.1'), issue('e.2.2')])
    expect(issuesGroupIssueIds([issue('e.1'), issue('e.3')], [child])).toEqual(['e.1', 'e.3', 'e.2.1', 'e.2.2'])
  })

  it('is empty for a group with no rows anywhere', () => {
    expect(issuesGroupIssueIds([], [node(issue('e.1', { type: 'epic' }), [])])).toEqual([])
  })
})

describe('issuesGroupSelectState', () => {
  const ids = ['a', 'b', 'c']

  it('is unchecked when nothing in the group is selected, even if others are', () => {
    expect(issuesGroupSelectState(ids, new Set(['x']))).toBe(false)
  })

  it('is indeterminate for a partial selection and checked for all of it', () => {
    expect(issuesGroupSelectState(ids, new Set(['a']))).toBe('indeterminate')
    expect(issuesGroupSelectState(ids, new Set(['a', 'b', 'c', 'x']))).toBe(true)
  })
})

describe('issuesBulkEpicItems', () => {
  it('offers open epics only and never one that is itself selected', () => {
    const issues = [
      issue('p-2', { type: 'epic' }),
      issue('p-1', { type: 'epic' }),
      issue('p-3', { type: 'epic', status: 'closed' }),
      issue('p-4', { type: 'epic' }),
      issue('p-5'),
    ]
    expect(issuesBulkEpicItems(issues, new Set(['p-4'])).map(item => item.value)).toEqual(['p-1', 'p-2'])
  })
})

describe('issuesBulkStatusItems', () => {
  it('lists the known statuses with their display labels', () => {
    expect(issuesBulkStatusItems().map(item => [item.value, item.label])).toEqual([
      ['open', 'Open'],
      ['in_progress', 'In progress'],
      ['blocked', 'Blocked'],
      ['deferred', 'Deferred'],
      ['closed', 'Closed'],
    ])
  })
})

describe('issuesSelectionHasParent', () => {
  const issues = [
    issue('a'),
    issue('b', { parentId: 'e' }),
    issue('c', { dependencies: [{ issueId: 'c', dependsOnId: 'e', type: 'parent-child' }] as Issue['dependencies'] }),
  ]

  it('is true when any selected issue hangs under an epic, by parentId or parent-child edge', () => {
    expect(issuesSelectionHasParent(new Set(['a', 'b']), issues)).toBe(true)
    expect(issuesSelectionHasParent(new Set(['c']), issues)).toBe(true)
  })

  it('is false when no selected issue has a parent', () => {
    expect(issuesSelectionHasParent(new Set(['a']), issues)).toBe(false)
  })
})

describe('issuesPrunedSelection', () => {
  it('drops ids that left the list', () => {
    expect(issuesPrunedSelection(new Set(['a', 'gone', 'b']), [issue('a'), issue('b')])).toEqual(['a', 'b'])
  })

  it('returns null when every selected id is still present', () => {
    expect(issuesPrunedSelection(new Set(['a']), [issue('a'), issue('b')])).toBeNull()
  })
})
