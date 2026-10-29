import type { BadgeProps } from '@nuxt/ui'
import type { IssueLink, IssueStatus, IssueType } from '@candy-mountain/shared'

type IssuesColor = NonNullable<BadgeProps['color']>

export interface IssuesBadgeMeta {
  label: string
  color: IssuesColor
  icon: string
}

const STATUS_META: Record<string, IssuesBadgeMeta> = {
  open: { label: 'Open', color: 'success', icon: 'i-lucide-circle' },
  in_progress: { label: 'In progress', color: 'warning', icon: 'i-lucide-circle-dot' },
  blocked: { label: 'Blocked', color: 'error', icon: 'i-lucide-ban' },
  deferred: { label: 'Deferred', color: 'info', icon: 'i-lucide-circle-pause' },
  closed: { label: 'Closed', color: 'neutral', icon: 'i-lucide-circle-check' },
}

const TYPE_META: Record<string, IssuesBadgeMeta> = {
  bug: { label: 'Bug', color: 'error', icon: 'i-lucide-bug' },
  feature: { label: 'Feature', color: 'primary', icon: 'i-lucide-origami' },
  task: { label: 'Task', color: 'info', icon: 'i-lucide-squirrel' },
  epic: { label: 'Epic', color: 'warning', icon: 'i-lucide-orbit' },
  decision: { label: 'Decision', color: 'success', icon: 'i-lucide-split' },
  chore: { label: 'Chore', color: 'neutral', icon: 'i-lucide-brush-cleaning' },
}

export const ISSUES_STAGE_LABEL_PREFIX = 'stage:'

function humanise(value: string): string {
  const words = value.replaceAll(/[_-]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : value
}

export function issuesStatusMeta(status: IssueStatus): IssuesBadgeMeta {
  return STATUS_META[status] ?? { label: humanise(status), color: 'info', icon: 'i-lucide-circle' }
}

export function issuesTypeMeta(type: IssueType): IssuesBadgeMeta {
  return TYPE_META[type] ?? { label: humanise(type), color: 'neutral', icon: 'i-lucide-circle' }
}

/** The badge stays neutral: the priority colour lives on the flame alone, from issuesPriorityFlameClass in issues-list. */
export function issuesPriorityMeta(priority: number): IssuesBadgeMeta {
  return { label: `P${priority}`, color: 'neutral', icon: 'i-lucide-flame' }
}

/** Stage labels are pipeline state rather than tags, so they render as their own chips ahead of the rest. */
export function issuesSplitLabels(labels: readonly string[]): { stages: string[], labels: string[] } {
  return {
    stages: labels.filter(label => label.startsWith(ISSUES_STAGE_LABEL_PREFIX)),
    labels: labels.filter(label => !label.startsWith(ISSUES_STAGE_LABEL_PREFIX)),
  }
}

export interface IssuesDetailLinkGroups {
  dependsOn: IssueLink[]
  dependents: IssueLink[]
  children: IssueLink[]
  parent: IssueLink | null
}

/** The parent shows as its own field and children get their own list, so parent-child edges stay out of the dependency lists. */
export function issuesDetailLinkGroups(issue: { parentId: string | null, dependsOn: IssueLink[], dependents: IssueLink[] }): IssuesDetailLinkGroups {
  const isParentEdge = (link: IssueLink) => link.dependencyType === 'parent-child'
  return {
    dependsOn: issue.dependsOn.filter(link => !isParentEdge(link)),
    dependents: issue.dependents.filter(link => !isParentEdge(link)),
    children: issue.dependents.filter(isParentEdge),
    parent: issue.dependsOn.find(link => isParentEdge(link) && link.id === issue.parentId) ?? null,
  }
}
