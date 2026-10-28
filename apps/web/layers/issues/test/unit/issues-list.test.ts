import type { IssueDependency } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { issuesBlockedIds, issuesFilterTree, issuesMatchesSearch, issuesShortId, type IssuesListItem } from '../../app/utils/issues-list'
import { issuesGroupTree } from '../../app/utils/issues-tree'

interface Fixture {
  title?: string
  type?: string
  status?: string
  parent?: string
  blockers?: string[]
  ready?: boolean
}

function item(id: string, { title = id, type = 'task', status = 'open', parent, blockers = [], ready = false }: Fixture = {}): IssuesListItem {
  const dependencies: IssueDependency[] = [
    ...(parent ? [{ issueId: id, dependsOnId: parent, type: 'parent-child' }] : []),
    ...blockers.map(dependsOnId => ({ issueId: id, dependsOnId, type: 'blocks' })),
  ]
  return { id, title, type, status, parentId: parent ?? null, dependencies, ready }
}

const ids = (items: readonly IssuesListItem[]) => items.map(issue => issue.id)

describe('issuesShortId', () => {
  it('strips the prefix up to the last hyphen and uppercases the rest', () => {
    expect(issuesShortId('candy-mountain-v3-x8m.3.6')).toBe('X8M.3.6')
    expect(issuesShortId('noprefix')).toBe('NOPREFIX')
    expect(issuesShortId('trailing-')).toBe('trailing-')
  })
})

describe('issuesBlockedIds', () => {
  it('counts open blockers and the blocked status, never closed issues or missing blockers', () => {
    const issues = [
      item('p-a'),
      item('p-b', { blockers: ['p-a'] }),
      item('p-c', { blockers: ['p-d'] }),
      item('p-d', { status: 'closed' }),
      item('p-e', { status: 'blocked' }),
      item('p-f', { blockers: ['p-gone'] }),
      item('p-g', { status: 'closed', blockers: ['p-a'] }),
    ]
    expect([...issuesBlockedIds(issues)].sort()).toEqual(['p-b', 'p-e'])
  })

  it('ignores non-blocking edges', () => {
    expect(issuesBlockedIds([item('p-epic', { type: 'epic' }), item('p-a', { parent: 'p-epic' })]).size).toBe(0)
  })
})

describe('issuesMatchesSearch', () => {
  it('matches title and id case-insensitively, including the short id', () => {
    const issue = item('cm-x8m.3.6', { title: 'Build the Issues list' })
    expect(issuesMatchesSearch(issue, 'issues LIST')).toBe(true)
    expect(issuesMatchesSearch(issue, 'X8M.3.6')).toBe(true)
    expect(issuesMatchesSearch(issue, '  ')).toBe(true)
    expect(issuesMatchesSearch(issue, 'detail')).toBe(false)
  })
})

describe('issuesFilterTree', () => {
  const issues = [
    item('p-e1', { type: 'epic', title: 'Platform' }),
    item('p-e1.1', { parent: 'p-e1', title: 'Shell', ready: true }),
    item('p-e1.2', { parent: 'p-e1', title: 'Router', blockers: ['p-e1.1'] }),
    item('p-e1.3', { type: 'epic', parent: 'p-e1', title: 'Nested' }),
    item('p-e1.3.1', { parent: 'p-e1.3', title: 'Deep router' }),
    item('p-e2', { type: 'epic', title: 'Billing' }),
    item('p-e2.1', { parent: 'p-e2', title: 'Invoices' }),
    item('p-o1', { title: 'Loose router', ready: true }),
  ]
  const tree = issuesGroupTree(issues)
  const blocked = issuesBlockedIds(issues)

  it('returns the tree untouched without filters', () => {
    expect(issuesFilterTree(tree, { state: null, search: '' }, blocked)).toBe(tree)
  })

  it('keeps only ready rows and prunes groups left empty, keeping subtree counts', () => {
    const result = issuesFilterTree(tree, { state: 'ready', search: '' }, blocked)
    expect(result.groups.map(node => node.epic.id)).toEqual(['p-e1'])
    expect(ids(result.groups[0]!.issues)).toEqual(['p-e1.1'])
    expect(result.groups[0]!.epics).toEqual([])
    expect(result.groups[0]!.totalCount).toBe(3)
    expect(ids(result.ungrouped!.issues)).toEqual(['p-o1'])
  })

  it('keeps only blocked rows', () => {
    const result = issuesFilterTree(tree, { state: 'blocked', search: '' }, blocked)
    expect(result.groups.map(node => ids(node.issues))).toEqual([['p-e1.2']])
    expect(result.ungrouped).toBeNull()
  })

  it('searches rows at every depth', () => {
    const result = issuesFilterTree(tree, { state: null, search: 'router' }, blocked)
    expect(ids(result.groups[0]!.issues)).toEqual(['p-e1.2'])
    expect(ids(result.groups[0]!.epics[0]!.issues)).toEqual(['p-e1.3.1'])
    expect(ids(result.ungrouped!.issues)).toEqual(['p-o1'])
  })

  it('shows a whole group when the search matches its epic', () => {
    const result = issuesFilterTree(tree, { state: null, search: 'p-e2' }, blocked)
    expect(result.groups.map(node => node.epic.id)).toEqual(['p-e2'])
    expect(ids(result.groups[0]!.issues)).toEqual(['p-e2.1'])
    expect(result.ungrouped).toBeNull()
  })

  it('applies the state filter inside a matched epic and still shows the epic', () => {
    const result = issuesFilterTree(tree, { state: 'ready', search: 'billing' }, blocked)
    expect(result.groups.map(node => node.epic.id)).toEqual(['p-e2'])
    expect(result.groups[0]!.issues).toEqual([])
  })
})
