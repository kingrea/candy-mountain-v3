import { describe, expect, it } from 'vitest'
import { ISSUES_UNASSIGN_VALUE, issuesAssigneeFromSelection, issuesAssigneeItems } from '../../app/utils/assignees'

describe('issuesAssigneeItems', () => {
  it('lists the project names and offers no unassign when nobody is assigned', () => {
    expect(issuesAssigneeItems(['Ana', 'Ben'], null).map(item => item.value)).toEqual(['Ana', 'Ben'])
  })

  it('offers unassign last once someone is assigned', () => {
    const items = issuesAssigneeItems(['Ana', 'Ben'], 'Ben')
    expect(items.map(item => item.value)).toEqual(['Ana', 'Ben', ISSUES_UNASSIGN_VALUE])
  })

  it('keeps an assignee that is not on the project list selectable', () => {
    expect(issuesAssigneeItems(['Ana'], 'jack').map(item => item.value)).toEqual(['Ana', 'jack', ISSUES_UNASSIGN_VALUE])
  })
})

describe('issuesAssigneeFromSelection', () => {
  it('maps unassign and empty selections to null and passes names through', () => {
    expect(issuesAssigneeFromSelection(ISSUES_UNASSIGN_VALUE)).toBeNull()
    expect(issuesAssigneeFromSelection(undefined)).toBeNull()
    expect(issuesAssigneeFromSelection('Ana')).toBe('Ana')
  })
})
