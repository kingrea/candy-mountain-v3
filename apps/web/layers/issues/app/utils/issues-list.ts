import type { Issue } from '@candy-mountain/shared'
import type { IssuesEpicNode, IssuesTree } from './issues-tree'

export type IssuesStateFilter = 'ready' | 'blocked' | null

export interface IssuesListFilters {
  state: IssuesStateFilter
  search: string
}

export type IssuesListItem = Pick<Issue, 'id' | 'title' | 'type' | 'status' | 'parentId' | 'dependencies' | 'ready'>

export const ISSUES_UNGROUPED_KEY = '__ungrouped__'

/** The list's useAsyncData key, so other code can refresh it with refreshNuxtData. */
export function issuesListKey(slug: string): string {
  return `issues:list:${slug}`
}

export function issuesShortId(id: string): string {
  const short = id.slice(id.lastIndexOf('-') + 1)
  return short ? short.toUpperCase() : id
}

/** A blocker missing from the list is ignored, since nothing here says it is still open. */
export function issuesBlockedIds(issues: readonly Pick<Issue, 'id' | 'status' | 'dependencies'>[]): Set<string> {
  const openIds = new Set(issues.filter(issue => issue.status !== 'closed').map(issue => issue.id))
  return new Set(issues
    .filter(issue => issue.status !== 'closed')
    .filter(issue => issue.status === 'blocked'
      || issue.dependencies.some(dependency => dependency.type === 'blocks' && openIds.has(dependency.dependsOnId)))
    .map(issue => issue.id))
}

export function issuesMatchesSearch(issue: Pick<Issue, 'id' | 'title'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle === '' || issue.title.toLowerCase().includes(needle) || issue.id.toLowerCase().includes(needle)
}

export function issuesFiltersActive(filters: IssuesListFilters): boolean {
  return filters.state !== null || filters.search.trim() !== ''
}

/** Counts keep covering the whole subtree, and an epic matching the search keeps all its rows so searching for an epic shows its group. */
export function issuesFilterTree<T extends IssuesListItem>(tree: IssuesTree<T>, filters: IssuesListFilters, blockedIds: ReadonlySet<string>): IssuesTree<T> {
  if (!issuesFiltersActive(filters)) return tree
  const searching = filters.search.trim() !== ''
  const stateMatches = (issue: T) =>
    filters.state === null || (filters.state === 'ready' ? issue.ready : blockedIds.has(issue.id))

  const filterNode = (node: IssuesEpicNode<T>, ancestorMatched: boolean): IssuesEpicNode<T> | null => {
    const epicMatched = searching && issuesMatchesSearch(node.epic, filters.search)
    const showAll = ancestorMatched || epicMatched
    const issues = node.issues.filter(issue => stateMatches(issue) && (showAll || issuesMatchesSearch(issue, filters.search)))
    const epics = node.epics
      .map(child => filterNode(child, showAll))
      .filter((child): child is IssuesEpicNode<T> => child !== null)
    if (issues.length === 0 && epics.length === 0 && !epicMatched) return null
    return { ...node, issues, epics }
  }

  const groups = tree.groups
    .map(node => filterNode(node, false))
    .filter((node): node is IssuesEpicNode<T> => node !== null)
  const ungroupedIssues = tree.ungrouped?.issues.filter(issue => stateMatches(issue) && issuesMatchesSearch(issue, filters.search)) ?? []
  const ungrouped = tree.ungrouped && ungroupedIssues.length > 0 ? { ...tree.ungrouped, issues: ungroupedIssues } : null

  return { groups, ungrouped }
}

export const ISSUES_STATUS_TEXT_CLASSES: Record<string, string> = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  neutral: 'text-muted',
}

const TYPE_COLOR_CLASSES: Record<string, string> = {
  bug: 'text-red-500',
  feature: 'text-purple-500',
  task: 'text-blue-500',
  epic: 'text-amber-500',
  decision: 'text-teal-500',
  chore: 'text-zinc-500',
}

export function issuesTypeColorClass(type: string): string {
  return TYPE_COLOR_CLASSES[type] ?? 'text-muted'
}

// The flame is a CSS mask, so a background gradient paints it; the others colour it through currentColor.
const PRIORITY_FLAME_CLASSES = [
  'bg-linear-to-tr from-red-500 to-yellow-400',
  'text-red-500',
  'text-yellow-500',
  'text-sky-300',
  'text-gray-300 dark:text-gray-500',
]

export function issuesPriorityFlameClass(priority: number): string {
  return PRIORITY_FLAME_CLASSES[priority] ?? 'text-muted'
}
