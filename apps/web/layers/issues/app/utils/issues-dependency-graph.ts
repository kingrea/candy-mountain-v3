import type { Issue, IssueDependency } from '@candy-mountain/shared'
import { issuesSortSiblings } from './issues-order'
import { issuesParentId } from './issues-tree'

export type IssuesGraphItem = Pick<Issue, 'id' | 'title' | 'status' | 'type' | 'parentId' | 'dependencies'>

export interface IssuesGraphNode<T extends IssuesGraphItem = IssuesGraphItem> {
  issue: T
  layer: number
  x: number
  y: number
}

export interface IssuesGraphEdge {
  /** The blocker; arrows point from it to the issue it blocks. */
  from: string
  to: string
  path: string
  /** True for an edge that closes a blocking cycle, so it runs against the layer direction. */
  back: boolean
}

export interface IssuesDependencyGraphLayout<T extends IssuesGraphItem = IssuesGraphItem> {
  nodes: IssuesGraphNode<T>[]
  edges: IssuesGraphEdge[]
  width: number
  height: number
}

export const ISSUES_GRAPH_NODE_WIDTH = 220
export const ISSUES_GRAPH_NODE_HEIGHT = 52
export const ISSUES_GRAPH_COLUMN_GAP = 56
export const ISSUES_GRAPH_ROW_GAP = 16
export const ISSUES_GRAPH_PADDING = 8

const COLUMN_STEP = ISSUES_GRAPH_NODE_WIDTH + ISSUES_GRAPH_COLUMN_GAP
const ROW_STEP = ISSUES_GRAPH_NODE_HEIGHT + ISSUES_GRAPH_ROW_GAP

function descendantsOf<T extends IssuesGraphItem>(epicId: string, issues: readonly T[]): T[] {
  const children = new Map<string, T[]>()
  for (const issue of issues) {
    const parent = issuesParentId(issue)
    if (parent !== null) children.set(parent, [...(children.get(parent) ?? []), issue])
  }

  const seen = new Set([epicId])
  const found: T[] = []
  const queue = [epicId]
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      found.push(child)
      queue.push(child.id)
    }
  }
  return found
}

function edgePath(fromX: number, fromY: number, toX: number, toY: number): string {
  const bend = Math.max(ISSUES_GRAPH_COLUMN_GAP / 2, Math.abs(toX - fromX) / 3)
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`
}

/** Lays out an epic's descendants in columns by longest blocker chain, so every issue sits right of everything blocking it. */
export function issuesDependencyGraph<T extends IssuesGraphItem>(
  epicId: string,
  issues: readonly T[],
  edges: readonly IssueDependency[],
): IssuesDependencyGraphLayout<T> {
  const members = issuesSortSiblings(descendantsOf(epicId, issues))
  const ids = new Set(members.map(issue => issue.id))

  const seenEdges = new Set<string>()
  const blocking = edges.filter((edge) => {
    const key = `${edge.dependsOnId}\n${edge.issueId}`
    if (edge.type !== 'blocks' || edge.issueId === edge.dependsOnId || !ids.has(edge.issueId) || !ids.has(edge.dependsOnId) || seenEdges.has(key)) return false
    seenEdges.add(key)
    return true
  })

  const blockersOf = new Map<string, string[]>()
  for (const edge of blocking) blockersOf.set(edge.issueId, [...(blockersOf.get(edge.issueId) ?? []), edge.dependsOnId])

  const layers = new Map<string, number>()
  const visiting = new Set<string>()
  const layerOf = (id: string): number => {
    const known = layers.get(id)
    if (known !== undefined) return known
    // Reaching an issue still on the stack means a cycle; dropping that edge keeps the layering finite.
    if (visiting.has(id)) return -1
    visiting.add(id)
    const layer = Math.max(-1, ...(blockersOf.get(id) ?? []).map(layerOf)) + 1
    visiting.delete(id)
    layers.set(id, layer)
    return layer
  }

  const columns: T[][] = []
  for (const issue of members) (columns[layerOf(issue.id)] ??= []).push(issue)

  const rows = Math.max(0, ...columns.map(column => column.length))
  const position = new Map<string, { x: number, y: number }>()
  const nodes: IssuesGraphNode<T>[] = []

  columns.forEach((column, layer) => {
    const top = ISSUES_GRAPH_PADDING + ((rows - column.length) * ROW_STEP) / 2
    const centre = (index: number) => top + index * ROW_STEP

    // One barycentre pass pulls each issue level with its blockers, which keeps most edges short and uncrossed.
    const ordered = column
      .map((issue, index) => {
        const placed = (blockersOf.get(issue.id) ?? []).map(id => position.get(id)?.y).filter((y): y is number => y !== undefined)
        const weight = placed.length > 0 ? placed.reduce((sum, y) => sum + y, 0) / placed.length : centre(index)
        return { issue, index, weight }
      })
      .sort((a, b) => a.weight - b.weight || a.index - b.index)

    ordered.forEach(({ issue }, index) => {
      const x = ISSUES_GRAPH_PADDING + layer * COLUMN_STEP
      const y = centre(index)
      position.set(issue.id, { x, y })
      nodes.push({ issue, layer, x, y })
    })
  })

  const middle = ISSUES_GRAPH_NODE_HEIGHT / 2
  const graphEdges = blocking.map((edge): IssuesGraphEdge => {
    const from = position.get(edge.dependsOnId)!
    const to = position.get(edge.issueId)!
    return {
      from: edge.dependsOnId,
      to: edge.issueId,
      path: edgePath(from.x + ISSUES_GRAPH_NODE_WIDTH, from.y + middle, to.x, to.y + middle),
      back: layers.get(edge.issueId)! <= layers.get(edge.dependsOnId)!,
    }
  })

  return {
    nodes,
    edges: graphEdges,
    width: columns.length === 0 ? 0 : columns.length * COLUMN_STEP - ISSUES_GRAPH_COLUMN_GAP + 2 * ISSUES_GRAPH_PADDING,
    height: rows === 0 ? 0 : rows * ROW_STEP - ISSUES_GRAPH_ROW_GAP + 2 * ISSUES_GRAPH_PADDING,
  }
}

export function issuesGraphLabel(title: string, maxLength: number): string {
  return title.length <= maxLength ? title : `${title.slice(0, maxLength - 1).trimEnd()}…`
}
