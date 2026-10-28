import type { Issue } from '@candy-mountain/shared'
import { ISSUE_TEXT_MAX_LENGTH, ISSUE_TITLE_MAX_LENGTH } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  issuesEditChanges,
  issuesEditProblem,
  issuesLabelProblem,
  issuesLabelsAdd,
  issuesLabelsEqual,
  issuesLabelsRemove,
  issuesParentCandidates,
  issuesTypeItems,
  type IssuesEditableValues,
} from '../../app/utils/issues-edit'

const current: IssuesEditableValues = {
  title: 'Fix the login',
  description: 'Steps to reproduce',
  acceptanceCriteria: null,
  notes: '',
  type: 'bug',
  priority: 2,
  labels: ['area:web', 'stage:review'],
  parentId: 'cm-1',
  assignee: 'alice',
}

function issue(id: string, parentId: string | null = null, status = 'open'): Issue {
  return {
    id,
    title: `Issue ${id}`,
    status,
    priority: 2,
    type: 'task',
    description: null,
    acceptanceCriteria: null,
    notes: null,
    assignee: null,
    owner: null,
    labels: [],
    parentId,
    createdAt: null,
    createdBy: null,
    updatedAt: null,
    startedAt: null,
    closedAt: null,
    closeReason: null,
    commentCount: 0,
    ready: false,
    dependencies: [],
  }
}

describe('issuesEditChanges', () => {
  it('sends nothing when the draft matches the issue', () => {
    expect(issuesEditChanges(current, {
      title: ' Fix the login ',
      description: 'Steps to reproduce\n',
      acceptanceCriteria: '  ',
      notes: null,
      type: 'bug',
      priority: 2,
      labels: ['stage:review', 'area:web'],
      parentId: 'cm-1',
      assignee: 'alice',
    })).toEqual({})
  })

  it('sends only the fields that changed', () => {
    expect(issuesEditChanges(current, { title: 'Fix the logout', priority: 0, description: 'Steps to reproduce' }))
      .toEqual({ title: 'Fix the logout', priority: 0 })
  })

  it('clears text, parent and assignee with null', () => {
    expect(issuesEditChanges(current, { description: '   ', parentId: '', assignee: null }))
      .toEqual({ description: null, parentId: null, assignee: null })
  })

  it('keeps leading markdown indentation but drops trailing whitespace', () => {
    expect(issuesEditChanges(current, { notes: '    code block\n\n' })).toEqual({ notes: '    code block' })
  })

  it('sends the whole label set, trimmed and de-duplicated, when it changes', () => {
    expect(issuesEditChanges(current, { labels: ['area:web', ' ui ', 'ui'] })).toEqual({ labels: ['area:web', 'ui'] })
    expect(issuesEditChanges(current, { labels: [] })).toEqual({ labels: [] })
  })

  it('sends a type change and a new parent', () => {
    expect(issuesEditChanges(current, { type: 'feature', parentId: 'cm-2' })).toEqual({ type: 'feature', parentId: 'cm-2' })
  })
})

describe('issuesEditProblem', () => {
  it('refuses an empty or overlong title', () => {
    expect(issuesEditProblem({ title: '' })).toBe('Title is required')
    expect(issuesEditProblem({ title: 'x'.repeat(ISSUE_TITLE_MAX_LENGTH + 1) })).toMatch(/at most/)
  })

  it('refuses overlong text and comma labels', () => {
    expect(issuesEditProblem({ notes: 'x'.repeat(ISSUE_TEXT_MAX_LENGTH + 1) })).toMatch(/^Notes must be at most/)
    expect(issuesEditProblem({ labels: ['a,b'] })).toBe('Labels cannot contain commas')
  })

  it('accepts a valid change', () => {
    expect(issuesEditProblem({ title: 'Fine', description: null, labels: ['ok'] })).toBeNull()
  })
})

describe('label set operations', () => {
  it('adds a trimmed label once', () => {
    expect(issuesLabelsAdd(['a'], ' b ')).toEqual(['a', 'b'])
    expect(issuesLabelsAdd(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })

  it('ignores labels the tracker cannot store', () => {
    expect(issuesLabelsAdd(['a'], '  ')).toEqual(['a'])
    expect(issuesLabelsAdd(['a'], 'b,c')).toEqual(['a'])
    expect(issuesLabelProblem('b,c')).toBe('Labels cannot contain commas')
    expect(issuesLabelProblem('')).toBe('A label cannot be empty')
    expect(issuesLabelProblem('ok')).toBeNull()
  })

  it('removes a label and compares sets regardless of order', () => {
    expect(issuesLabelsRemove(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(issuesLabelsRemove(['a'], 'z')).toEqual(['a'])
    expect(issuesLabelsEqual(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(issuesLabelsEqual(['a', 'b'], ['a'])).toBe(false)
  })
})

describe('issuesParentCandidates', () => {
  it('leaves out the issue and everything below it', () => {
    const issues = [issue('x-1'), issue('x-2', 'x-1'), issue('x-3', 'x-2'), issue('x-4'), issue('x-5', 'x-4')]
    expect(issuesParentCandidates(issues, 'x-1').map(candidate => candidate.id)).toEqual(['x-4', 'x-5'])
    expect(issuesParentCandidates(issues, null)).toHaveLength(5)
  })
})

describe('issuesTypeItems', () => {
  it('keeps a custom type selectable', () => {
    expect(issuesTypeItems('bug').map(item => item.value)).toEqual(['bug', 'feature', 'task', 'epic', 'chore', 'decision'])
    expect(issuesTypeItems('spike').at(-1)).toEqual({ label: 'Spike', value: 'spike', icon: 'i-lucide-circle' })
  })
})
