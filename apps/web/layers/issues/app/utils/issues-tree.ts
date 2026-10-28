import type { Issue } from '@candy-mountain/shared'
import { issuesSortSiblings } from './issues-order'

export type IssuesTreeItem = Pick<Issue, 'id' | 'title' | 'type' | 'status' | 'parentId' | 'dependencies'>

export interface IssuesEpicNode<T extends IssuesTreeItem = Issue> {
  epic: T
  /** Direct non-epic children left after the closed filter, in sibling order. */
  issues: T[]
  epics: IssuesEpicNode<T>[]
  /** Non-epic issues anywhere under the epic, ignoring the closed filter. */
  openCount: number
  totalCount: number
}

export interface IssuesUngroupedBucket<T extends IssuesTreeItem = Issue> {
  issues: T[]
  openCount: number
  totalCount: number
}

export interface IssuesTree<T extends IssuesTreeItem = Issue> {
  groups: IssuesEpicNode<T>[]
  /** Null when no non-epic issue sits outside an epic; may hold zero visible issues when they are all closed. */
  ungrouped: IssuesUngroupedBucket<T> | null
}

export interface IssuesTreeOptions {
  showClosed?: boolean
}

export function issuesParentId(issue: Pick<Issue, 'parentId' | 'dependencies'>): string | null {
  return issue.parentId ?? issue.dependencies.find(dependency => dependency.type === 'parent-child')?.dependsOnId ?? null
}

const isEpic = (issue: IssuesTreeItem) => issue.type === 'epic'
const isClosed = (issue: IssuesTreeItem) => issue.status === 'closed'

export function issuesGroupTree<T extends IssuesTreeItem>(issues: readonly T[], options: IssuesTreeOptions = {}): IssuesTree<T> {
  const showClosed = options.showClosed ?? false
  const epics = issues.filter(isEpic)
  const epicIds = new Set(epics.map(epic => epic.id))
  const issueChildren = new Map<string, T[]>()
  const epicChildren = new Map<string, T[]>()

  for (const issue of issues) {
    const parent = issuesParentId(issue) ?? ''
    const collection = isEpic(issue) ? epicChildren : issueChildren
    collection.set(parent, [...(collection.get(parent) ?? []), issue])
  }

  const visibleOf = (children: readonly T[]) => issuesSortSiblings(showClosed ? children : children.filter(issue => !isClosed(issue)))

  const descendantsOf = (epicId: string, seen: Set<string>): T[] => [
    ...(issueChildren.get(epicId) ?? []),
    ...(epicChildren.get(epicId) ?? [])
      .filter(child => !seen.has(child.id))
      .flatMap(child => descendantsOf(child.id, new Set(seen).add(child.id))),
  ]

  const buildNode = (epic: T, seen: Set<string>): IssuesEpicNode<T> | null => {
    const nextSeen = new Set(seen).add(epic.id)
    const nestedEpics = issuesSortSiblings(epicChildren.get(epic.id) ?? [])
      .filter(child => !nextSeen.has(child.id))
      .map(child => buildNode(child, nextSeen))
      .filter((node): node is IssuesEpicNode<T> => node !== null)
    const visible = visibleOf(issueChildren.get(epic.id) ?? [])

    if (!showClosed && isClosed(epic) && visible.length === 0 && nestedEpics.length === 0) return null

    const descendants = descendantsOf(epic.id, nextSeen)
    return {
      epic,
      issues: visible,
      epics: nestedEpics,
      openCount: descendants.filter(issue => !isClosed(issue)).length,
      totalCount: descendants.length,
    }
  }

  // An epic under another epic is reached by recursion, so a parent cycle among epics has no root and is not shown.
  const groups = issuesSortSiblings(epics)
    .filter(epic => !epicIds.has(issuesParentId(epic) ?? ''))
    .map(epic => buildNode(epic, new Set()))
    .filter((node): node is IssuesEpicNode<T> => node !== null)

  const orphans = [...issueChildren.entries()]
    .filter(([parent]) => !epicIds.has(parent))
    .flatMap(([, children]) => children)
  const ungrouped = orphans.length === 0
    ? null
    : {
        issues: visibleOf(orphans),
        openCount: orphans.filter(issue => !isClosed(issue)).length,
        totalCount: orphans.length,
      }

  return { groups, ungrouped }
}
