import { describe, expect, it } from 'vitest'
import type { IssueLink } from '@candy-mountain/shared'
import { issuesDetailLinkGroups, issuesPriorityMeta, issuesSplitLabels, issuesStatusMeta, issuesTypeMeta } from '../../app/utils/issues-display'

function link(id: string, dependencyType: string): IssueLink {
  return { id, title: id, status: 'open', priority: 2, type: 'task', dependencyType }
}

describe('issue display metadata', () => {
  it('labels known statuses and types and passes unknown ones through readably', () => {
    expect(issuesStatusMeta('in_progress')).toMatchObject({ label: 'In progress', color: 'warning' })
    expect(issuesStatusMeta('needs_review').label).toBe('Needs review')
    expect(issuesTypeMeta('epic')).toMatchObject({ label: 'Epic', icon: 'i-lucide-orbit' })
    expect(issuesTypeMeta('spike').label).toBe('Spike')
  })

  it('names priorities P0 to P4 with a neutral badge, leaving the colour to the flame', () => {
    expect(issuesPriorityMeta(0)).toMatchObject({ label: 'P0', color: 'neutral', icon: 'i-lucide-flame' })
    expect(issuesPriorityMeta(4)).toMatchObject({ label: 'P4', color: 'neutral' })
  })

  it('splits stage labels from the rest, keeping order', () => {
    expect(issuesSplitLabels(['agent:opus', 'stage:review', 'points:3', 'stage:build'])).toEqual({
      stages: ['stage:review', 'stage:build'],
      labels: ['agent:opus', 'points:3'],
    })
  })
})

describe('issuesDetailLinkGroups', () => {
  it('pulls the parent and children out of the dependency lists', () => {
    const groups = issuesDetailLinkGroups({
      parentId: 'epic',
      dependsOn: [link('epic', 'parent-child'), link('blocker', 'blocks')],
      dependents: [link('child', 'parent-child'), link('waiting', 'blocks'), link('seen', 'related')],
    })
    expect(groups.parent?.id).toBe('epic')
    expect(groups.dependsOn.map(item => item.id)).toEqual(['blocker'])
    expect(groups.dependents.map(item => item.id)).toEqual(['waiting', 'seen'])
    expect(groups.children.map(item => item.id)).toEqual(['child'])
  })

  it('has no parent link when the issue has no parent', () => {
    expect(issuesDetailLinkGroups({ parentId: null, dependsOn: [], dependents: [] }).parent).toBeNull()
  })
})
