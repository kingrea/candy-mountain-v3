import type { Issue, IssueDependency } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { issuesSortSiblings } from '../app/utils/issues-order'

type Orderable = Pick<Issue, 'id' | 'title' | 'dependencies'>

function issue(id: string, title: string, blockers: string[] = []): Orderable {
  const dependencies: IssueDependency[] = [
    { issueId: id, dependsOnId: 'cm-epic', type: 'parent-child' },
    ...blockers.map(dependsOnId => ({ issueId: id, dependsOnId, type: 'blocks' })),
  ]
  return { id, title, dependencies }
}

const ids = (issues: Orderable[]) => issues.map(entry => entry.id)

describe('issuesSortSiblings', () => {
  it('orders hierarchical ids by their counter, not as text', () => {
    const sorted = issuesSortSiblings([issue('cm-8j2.10', 'Tenth'), issue('cm-8j2.2', 'Second'), issue('cm-8j2.1', 'First')])

    expect(ids(sorted)).toEqual(['cm-8j2.1', 'cm-8j2.2', 'cm-8j2.10'])
  })

  it('compares multi-level sequences level by level, shorter first on a shared prefix', () => {
    const sorted = issuesSortSiblings([issue('cm-x.3.1', 'C'), issue('cm-x.2.10', 'B'), issue('cm-x.2', 'A'), issue('cm-x.2.9', 'D')])

    expect(ids(sorted)).toEqual(['cm-x.2', 'cm-x.2.9', 'cm-x.2.10', 'cm-x.3.1'])
  })

  it('beats title order with id sequence', () => {
    const sorted = issuesSortSiblings([issue('cm-8j2.2', 'Alpha'), issue('cm-8j2.1', 'Zulu')])

    expect(ids(sorted)).toEqual(['cm-8j2.1', 'cm-8j2.2'])
  })

  it('falls back to numeric title order for opaque short codes', () => {
    const sorted = issuesSortSiblings([
      issue('cm-d8xm', 'Phase 3 — third'),
      issue('cm-05j7', 'Phase 12 — twelfth'),
      issue('cm-azzy', 'Phase 2b — second and a half'),
      issue('cm-1zw', 'Phase 10 — tenth'),
      issue('cm-58q', 'Phase 2 — second'),
      issue('cm-bx8j', 'phase 1 — first'),
    ])

    expect(sorted.map(entry => entry.title)).toEqual([
      'phase 1 — first',
      'Phase 2 — second',
      'Phase 2b — second and a half',
      'Phase 3 — third',
      'Phase 10 — tenth',
      'Phase 12 — twelfth',
    ])
  })

  it('treats an id with a non-numeric suffix as opaque', () => {
    const sorted = issuesSortSiblings([issue('cm-abc.x', 'Alpha'), issue('cm-abc.2', 'Zulu')])

    expect(ids(sorted)).toEqual(['cm-abc.2', 'cm-abc.x'])
  })

  it('breaks equal titles by id', () => {
    const sorted = issuesSortSiblings([issue('cm-bbb', 'Same'), issue('cm-aaa', 'same')])

    expect(ids(sorted)).toEqual(['cm-aaa', 'cm-bbb'])
  })

  it('puts hierarchical ids ahead of short codes', () => {
    const sorted = issuesSortSiblings([issue('cm-abc', 'Alpha'), issue('cm-8j2.1', 'Zulu')])

    expect(ids(sorted)).toEqual(['cm-8j2.1', 'cm-abc'])
  })

  it('drops an issue below the sibling blocking it', () => {
    const sorted = issuesSortSiblings([issue('cm-aaa', 'Adopt the contract', ['cm-zzz']), issue('cm-zzz', 'Zulu: write the contract')])

    expect(ids(sorted)).toEqual(['cm-zzz', 'cm-aaa'])
  })

  it('moves a blocked issue only as far as its blocker, keeping the rest in rank order', () => {
    const sorted = issuesSortSiblings([
      issue('cm-e.1', 'One', ['cm-e.3']),
      issue('cm-e.2', 'Two'),
      issue('cm-e.3', 'Three'),
      issue('cm-e.4', 'Four'),
    ])

    expect(ids(sorted)).toEqual(['cm-e.2', 'cm-e.3', 'cm-e.1', 'cm-e.4'])
  })

  it('ignores parent-child and non-blocking edges when ordering', () => {
    const related: Orderable = { id: 'cm-aaa', title: 'Alpha', dependencies: [{ issueId: 'cm-aaa', dependsOnId: 'cm-bbb', type: 'related' }] }
    const sorted = issuesSortSiblings([issue('cm-bbb', 'Bravo'), related])

    expect(ids(sorted)).toEqual(['cm-aaa', 'cm-bbb'])
  })

  it('ignores blockers that are not siblings', () => {
    const sorted = issuesSortSiblings([issue('cm-bbb', 'Bravo'), issue('cm-aaa', 'Alpha', ['cm-hidden'])])

    expect(ids(sorted)).toEqual(['cm-aaa', 'cm-bbb'])
  })

  it('still returns every issue when blockers form a cycle, starting from the top-ranked one', () => {
    const sorted = issuesSortSiblings([
      issue('cm-bbb', 'Bravo', ['cm-aaa']),
      issue('cm-aaa', 'Alpha', ['cm-bbb']),
      issue('cm-ccc', 'Charlie', ['cm-aaa']),
    ])

    expect(ids(sorted)).toEqual(['cm-aaa', 'cm-bbb', 'cm-ccc'])
  })

  it('leaves the input array untouched', () => {
    const input = [issue('cm-8j2.2', 'Second'), issue('cm-8j2.1', 'First')]
    issuesSortSiblings(input)

    expect(ids(input)).toEqual(['cm-8j2.2', 'cm-8j2.1'])
  })
})
