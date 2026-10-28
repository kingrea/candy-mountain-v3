import { describe, expect, it } from 'vitest'
import { teamScopeFromForm, teamScopeLabels, teamScopeToForm } from '../../app/utils/team'

const bots = [{ id: 'b1', name: 'Ana' }, { id: 'b2', name: 'Bo' }]

describe('team scope helpers', () => {
  it('labels all and named bots, skipping deleted ones', () => {
    expect(teamScopeLabels({ all: true }, bots)).toEqual(['All bots'])
    expect(teamScopeLabels({ botIds: ['b2', 'gone'] }, bots)).toEqual(['Bo'])
    expect(teamScopeLabels({ botIds: [] }, bots)).toEqual([])
  })

  it('round-trips form state and drops stale ids', () => {
    expect(teamScopeFromForm('all', ['b1'])).toEqual({ all: true })
    expect(teamScopeFromForm('bots', ['b1'])).toEqual({ botIds: ['b1'] })
    expect(teamScopeToForm({ botIds: ['b1', 'gone'] }, bots)).toEqual({ mode: 'bots', botIds: ['b1'] })
    expect(teamScopeToForm({ all: true }, bots)).toEqual({ mode: 'all', botIds: [] })
    expect(teamScopeToForm(undefined, bots).mode).toBe('all')
  })
})
