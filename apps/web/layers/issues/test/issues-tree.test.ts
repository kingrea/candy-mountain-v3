import type { Issue, IssueDependency } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { type IssuesEpicNode, issuesGroupTree, issuesParentId } from '../app/utils/issues-tree'

interface Fixture {
  title?: string
  type?: Issue['type']
  status?: Issue['status']
  parent?: string
  blockers?: string[]
}

function issue(id: string, { title = id, type = 'task', status = 'open', parent, blockers = [] }: Fixture = {}): Issue {
  const dependencies: IssueDependency[] = [
    ...(parent ? [{ issueId: id, dependsOnId: parent, type: 'parent-child' }] : []),
    ...blockers.map(dependsOnId => ({ issueId: id, dependsOnId, type: 'blocks' })),
  ]
  return {
    id,
    title,
    status,
    priority: 2,
    type,
    description: null,
    acceptanceCriteria: null,
    notes: null,
    assignee: null,
    owner: null,
    labels: [],
    parentId: parent ?? null,
    createdAt: null,
    createdBy: null,
    updatedAt: null,
    startedAt: null,
    closedAt: null,
    closeReason: null,
    commentCount: 0,
    ready: false,
    dependencies,
  }
}

const epic = (id: string, fixture: Fixture = {}) => issue(id, { ...fixture, type: 'epic' })

interface Shape {
  id: string
  issues: string[]
  epics: Shape[]
  open: number
  total: number
}

function shape(node: IssuesEpicNode): Shape {
  return {
    id: node.epic.id,
    issues: node.issues.map(entry => entry.id),
    epics: node.epics.map(shape),
    open: node.openCount,
    total: node.totalCount,
  }
}

describe('issuesGroupTree', () => {
  it('turns each top-level epic into a group of its own issues', () => {
    const tree = issuesGroupTree([
      epic('cm-a'),
      issue('cm-a.1', { parent: 'cm-a' }),
      epic('cm-b'),
      issue('cm-b.1', { parent: 'cm-b' }),
      issue('cm-b.2', { parent: 'cm-b' }),
    ])

    expect(tree.groups.map(shape)).toEqual([
      { id: 'cm-a', issues: ['cm-a.1'], epics: [], open: 1, total: 1 },
      { id: 'cm-b', issues: ['cm-b.1', 'cm-b.2'], epics: [], open: 2, total: 2 },
    ])
    expect(tree.ungrouped).toBeNull()
  })

  it('treats an epic whose parent is a non-epic issue as top level', () => {
    const tree = issuesGroupTree([issue('cm-task'), epic('cm-e', { parent: 'cm-task' }), issue('cm-e.1', { parent: 'cm-e' })])

    expect(tree.groups.map(group => group.epic.id)).toEqual(['cm-e'])
    expect(tree.ungrouped?.issues.map(entry => entry.id)).toEqual(['cm-task'])
  })

  it('nests child epics recursively and counts every descendant issue', () => {
    const tree = issuesGroupTree([
      epic('cm-root'),
      issue('cm-root.1', { parent: 'cm-root' }),
      epic('cm-root.2', { parent: 'cm-root' }),
      issue('cm-root.2.1', { parent: 'cm-root.2', status: 'closed' }),
      issue('cm-root.2.2', { parent: 'cm-root.2' }),
      epic('cm-root.2.3', { parent: 'cm-root.2' }),
      issue('cm-root.2.3.1', { parent: 'cm-root.2.3', status: 'in_progress' }),
    ])

    expect(tree.groups.map(shape)).toEqual([
      {
        id: 'cm-root',
        issues: ['cm-root.1'],
        epics: [
          {
            id: 'cm-root.2',
            issues: ['cm-root.2.2'],
            epics: [{ id: 'cm-root.2.3', issues: ['cm-root.2.3.1'], epics: [], open: 1, total: 1 }],
            open: 2,
            total: 3,
          },
        ],
        open: 3,
        total: 4,
      },
    ])
  })

  it('counts issues inside hidden closed epics toward the ancestor totals', () => {
    const tree = issuesGroupTree([
      epic('cm-root'),
      issue('cm-root.1', { parent: 'cm-root' }),
      epic('cm-root.2', { parent: 'cm-root', status: 'closed' }),
      issue('cm-root.2.1', { parent: 'cm-root.2', status: 'closed' }),
    ])

    expect(tree.groups.map(shape)).toEqual([{ id: 'cm-root', issues: ['cm-root.1'], epics: [], open: 1, total: 2 }])
  })

  it('resolves the parent from a parent-child edge when parentId is missing', () => {
    const child = { ...issue('cm-a.1', { parent: 'cm-a' }), parentId: null }
    const tree = issuesGroupTree([epic('cm-a'), child])

    expect(issuesParentId(child)).toBe('cm-a')
    expect(tree.groups.map(shape)).toEqual([{ id: 'cm-a', issues: ['cm-a.1'], epics: [], open: 1, total: 1 }])
  })

  describe('closed issues', () => {
    const fixture = [
      epic('cm-done', { status: 'closed' }),
      issue('cm-done.1', { parent: 'cm-done', status: 'closed' }),
      epic('cm-empty', { status: 'closed' }),
      epic('cm-live'),
      issue('cm-live.1', { parent: 'cm-live', status: 'closed' }),
      issue('cm-live.2', { parent: 'cm-live' }),
      epic('cm-shell', { status: 'closed' }),
      epic('cm-shell.1', { parent: 'cm-shell' }),
      epic('cm-tail', { status: 'closed' }),
      issue('cm-tail.1', { parent: 'cm-tail' }),
    ]

    it('hides closed issues and closed epics with nothing visible', () => {
      const tree = issuesGroupTree(fixture)

      expect(tree.groups.map(shape)).toEqual([
        { id: 'cm-live', issues: ['cm-live.2'], epics: [], open: 1, total: 2 },
        { id: 'cm-shell', issues: [], epics: [{ id: 'cm-shell.1', issues: [], epics: [], open: 0, total: 0 }], open: 0, total: 0 },
        { id: 'cm-tail', issues: ['cm-tail.1'], epics: [], open: 1, total: 1 },
      ])
    })

    it('hides a closed nested epic with nothing visible', () => {
      const tree = issuesGroupTree([
        epic('cm-root'),
        epic('cm-root.1', { parent: 'cm-root', status: 'closed' }),
        epic('cm-root.2', { parent: 'cm-root' }),
      ])

      expect(tree.groups[0]?.epics.map(node => node.epic.id)).toEqual(['cm-root.2'])
    })

    it('shows everything when showClosed is on', () => {
      const tree = issuesGroupTree(fixture, { showClosed: true })

      expect(tree.groups.map(shape)).toEqual([
        { id: 'cm-done', issues: ['cm-done.1'], epics: [], open: 0, total: 1 },
        { id: 'cm-empty', issues: [], epics: [], open: 0, total: 0 },
        { id: 'cm-live', issues: ['cm-live.1', 'cm-live.2'], epics: [], open: 1, total: 2 },
        { id: 'cm-shell', issues: [], epics: [{ id: 'cm-shell.1', issues: [], epics: [], open: 0, total: 0 }], open: 0, total: 0 },
        { id: 'cm-tail', issues: ['cm-tail.1'], epics: [], open: 1, total: 1 },
      ])
    })
  })

  describe('ungrouped bucket', () => {
    it('collects issues with no parent or a non-epic parent, sorted as siblings', () => {
      const tree = issuesGroupTree([
        issue('cm-zzz', { title: 'Zulu' }),
        epic('cm-e'),
        issue('cm-sub', { title: 'Sub-task', parent: 'cm-aaa' }),
        issue('cm-aaa', { title: 'Alpha', blockers: ['cm-zzz'] }),
        issue('cm-gone', { title: 'Bravo', parent: 'cm-missing', status: 'closed' }),
      ])

      expect(tree.ungrouped).toEqual({
        issues: [expect.objectContaining({ id: 'cm-sub' }), expect.objectContaining({ id: 'cm-zzz' }), expect.objectContaining({ id: 'cm-aaa' })],
        openCount: 3,
        totalCount: 4,
      })
    })

    it('stays present with no visible issues when every ungrouped issue is closed', () => {
      const tree = issuesGroupTree([issue('cm-old', { status: 'closed' })])

      expect(tree.ungrouped).toEqual({ issues: [], openCount: 0, totalCount: 1 })
      expect(issuesGroupTree([issue('cm-old', { status: 'closed' })], { showClosed: true }).ungrouped?.issues).toHaveLength(1)
    })

    it('never takes epics', () => {
      expect(issuesGroupTree([epic('cm-e')]).ungrouped).toBeNull()
    })
  })

  describe('sibling order', () => {
    it('orders groups, nested epics and issues by id sequence, then title, then blockers', () => {
      const tree = issuesGroupTree([
        epic('cm-b', { title: 'Phase 10' }),
        epic('cm-a', { title: 'Phase 2' }),
        issue('cm-a.3', { parent: 'cm-a' }),
        issue('cm-a.10', { parent: 'cm-a' }),
        issue('cm-a.1', { parent: 'cm-a', blockers: ['cm-a.10'] }),
        epic('cm-a.12', { parent: 'cm-a' }),
        epic('cm-a.4', { parent: 'cm-a' }),
      ])

      expect(tree.groups.map(group => group.epic.title)).toEqual(['Phase 2', 'Phase 10'])
      expect(tree.groups[0]?.issues.map(entry => entry.id)).toEqual(['cm-a.3', 'cm-a.10', 'cm-a.1'])
      expect(tree.groups[0]?.epics.map(node => node.epic.id)).toEqual(['cm-a.4', 'cm-a.12'])
    })

    it('ignores blockers hidden by the closed filter and honours them when shown', () => {
      const fixture = [
        epic('cm-e'),
        issue('cm-e-x', { title: 'Alpha', parent: 'cm-e', blockers: ['cm-e-y'] }),
        issue('cm-e-y', { title: 'Bravo', parent: 'cm-e', status: 'closed' }),
        issue('cm-e-z', { title: 'Charlie', parent: 'cm-e' }),
      ]
      const tree = issuesGroupTree(fixture)

      expect(tree.groups[0]?.issues.map(entry => entry.id)).toEqual(['cm-e-x', 'cm-e-z'])
      expect(issuesGroupTree(fixture, { showClosed: true }).groups[0]?.issues.map(entry => entry.id)).toEqual(['cm-e-y', 'cm-e-x', 'cm-e-z'])
    })
  })

  describe('cycles', () => {
    it('terminates and leaves out epics whose parents form a cycle, with their issues', () => {
      const tree = issuesGroupTree([
        epic('cm-top'),
        epic('cm-loop-a', { parent: 'cm-loop-b' }),
        epic('cm-loop-b', { parent: 'cm-loop-a' }),
        issue('cm-loop-a.1', { parent: 'cm-loop-a' }),
        epic('cm-self', { parent: 'cm-self' }),
      ])

      expect(tree.groups.map(group => group.epic.id)).toEqual(['cm-top'])
      expect(tree.ungrouped).toBeNull()
    })

    it('stops nesting when an epic would reappear inside itself', () => {
      // With one parent per issue, only a duplicated id makes a cycle reachable from a root.
      const nested = epic('cm-root.1', { parent: 'cm-root' })
      const looping = epic('cm-root.1.1', { parent: 'cm-root.1' })
      const back = { ...epic('cm-root.1-again', { parent: 'cm-root.1.1' }), id: 'cm-root.1' }
      const tree = issuesGroupTree([epic('cm-root'), nested, looping, back, issue('cm-root.1.1.1', { parent: 'cm-root.1.1' })])

      expect(tree.groups.map(shape)).toEqual([
        {
          id: 'cm-root',
          issues: [],
          epics: [
            {
              id: 'cm-root.1',
              issues: [],
              epics: [{ id: 'cm-root.1.1', issues: ['cm-root.1.1.1'], epics: [], open: 1, total: 1 }],
              open: 1,
              total: 1,
            },
          ],
          open: 1,
          total: 1,
        },
      ])
    })
  })

  it('leaves the input untouched', () => {
    const input = [issue('cm-b'), issue('cm-a')]
    issuesGroupTree(input)

    expect(input.map(entry => entry.id)).toEqual(['cm-b', 'cm-a'])
  })
})
