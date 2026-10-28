import type { IssueDependency } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  ISSUES_GRAPH_COLUMN_GAP,
  ISSUES_GRAPH_NODE_HEIGHT,
  ISSUES_GRAPH_NODE_WIDTH,
  ISSUES_GRAPH_PADDING,
  ISSUES_GRAPH_ROW_GAP,
  type IssuesGraphItem,
  issuesDependencyGraph,
  issuesGraphLabel,
} from '../../app/utils/issues-dependency-graph'

interface Fixture {
  type?: string
  status?: string
  parent?: string
  blockers?: string[]
}

function issue(id: string, { type = 'task', status = 'open', parent, blockers = [] }: Fixture = {}): IssuesGraphItem {
  const dependencies: IssueDependency[] = [
    ...(parent ? [{ issueId: id, dependsOnId: parent, type: 'parent-child' }] : []),
    ...blockers.map(dependsOnId => ({ issueId: id, dependsOnId, type: 'blocks' })),
  ]
  return { id, title: id, status, type, parentId: parent ?? null, dependencies }
}

function graphOf(issues: IssuesGraphItem[], epicId = 'e') {
  return issuesDependencyGraph(epicId, issues, issues.flatMap(item => item.dependencies))
}

const layersOf = (graph: ReturnType<typeof graphOf>) =>
  Object.fromEntries(graph.nodes.map(node => [node.issue.id, node.layer]))
const edgesOf = (graph: ReturnType<typeof graphOf>) => graph.edges.map(edge => `${edge.from}>${edge.to}`)

describe('issuesDependencyGraph', () => {
  it('takes every descendant of the epic, including nested epics and their issues, but not the epic or outsiders', () => {
    const graph = graphOf([
      issue('e', { type: 'epic' }),
      issue('e.1', { parent: 'e' }),
      issue('e.2', { parent: 'e', type: 'epic' }),
      issue('e.2.1', { parent: 'e.2', status: 'closed' }),
      issue('other'),
      issue('f.1', { parent: 'f' }),
    ])
    expect(graph.nodes.map(node => node.issue.id).sort()).toEqual(['e.1', 'e.2', 'e.2.1'])
  })

  it('keeps only blocking edges between members, deduplicated, without self-loops', () => {
    const issues = [
      issue('e', { type: 'epic' }),
      issue('e.1', { parent: 'e', blockers: ['outside'] }),
      issue('e.2', { parent: 'e', blockers: ['e.1', 'e.2'] }),
      issue('outside'),
    ]
    const extra: IssueDependency[] = [
      { issueId: 'e.2', dependsOnId: 'e.1', type: 'blocks' },
      { issueId: 'e.2', dependsOnId: 'e.1', type: 'related' },
    ]
    const graph = issuesDependencyGraph('e', issues, [...issues.flatMap(item => item.dependencies), ...extra])
    expect(edgesOf(graph)).toEqual(['e.1>e.2'])
  })

  it('places each issue one layer past its longest blocker chain', () => {
    const graph = graphOf([
      issue('e', { type: 'epic' }),
      issue('e.1', { parent: 'e' }),
      issue('e.2', { parent: 'e', blockers: ['e.1'] }),
      issue('e.3', { parent: 'e', blockers: ['e.2'] }),
      issue('e.4', { parent: 'e', blockers: ['e.1', 'e.3'] }),
      issue('e.5', { parent: 'e' }),
    ])
    expect(layersOf(graph)).toEqual({ 'e.1': 0, 'e.5': 0, 'e.2': 1, 'e.3': 2, 'e.4': 3 })
    expect(graph.edges.every(edge => !edge.back)).toBe(true)
  })

  it('gives coordinates by layer and row, centring shorter columns, with a canvas that fits every node', () => {
    const graph = graphOf([
      issue('e', { type: 'epic' }),
      issue('e.1', { parent: 'e' }),
      issue('e.2', { parent: 'e' }),
      issue('e.3', { parent: 'e', blockers: ['e.1', 'e.2'] }),
    ])
    const at = Object.fromEntries(graph.nodes.map(node => [node.issue.id, { x: node.x, y: node.y }]))
    const rowStep = ISSUES_GRAPH_NODE_HEIGHT + ISSUES_GRAPH_ROW_GAP
    expect(at['e.1']).toEqual({ x: ISSUES_GRAPH_PADDING, y: ISSUES_GRAPH_PADDING })
    expect(at['e.2']).toEqual({ x: ISSUES_GRAPH_PADDING, y: ISSUES_GRAPH_PADDING + rowStep })
    expect(at['e.3']).toEqual({ x: ISSUES_GRAPH_PADDING + ISSUES_GRAPH_NODE_WIDTH + ISSUES_GRAPH_COLUMN_GAP, y: ISSUES_GRAPH_PADDING + rowStep / 2 })
    expect(graph.width).toBe(2 * ISSUES_GRAPH_NODE_WIDTH + ISSUES_GRAPH_COLUMN_GAP + 2 * ISSUES_GRAPH_PADDING)
    expect(graph.height).toBe(2 * ISSUES_GRAPH_NODE_HEIGHT + ISSUES_GRAPH_ROW_GAP + 2 * ISSUES_GRAPH_PADDING)
    for (const node of graph.nodes) {
      expect(node.x + ISSUES_GRAPH_NODE_WIDTH).toBeLessThanOrEqual(graph.width)
      expect(node.y + ISSUES_GRAPH_NODE_HEIGHT).toBeLessThanOrEqual(graph.height)
    }
  })

  it('runs each edge from the blocker\'s right side to the blocked issue\'s left side', () => {
    const graph = graphOf([
      issue('e', { type: 'epic' }),
      issue('e.1', { parent: 'e' }),
      issue('e.2', { parent: 'e', blockers: ['e.1'] }),
    ])
    const middle = ISSUES_GRAPH_PADDING + ISSUES_GRAPH_NODE_HEIGHT / 2
    const toX = ISSUES_GRAPH_PADDING + ISSUES_GRAPH_NODE_WIDTH + ISSUES_GRAPH_COLUMN_GAP
    expect(graph.edges[0]!.path).toMatch(new RegExp(`^M ${ISSUES_GRAPH_PADDING + ISSUES_GRAPH_NODE_WIDTH} ${middle} C .* ${toX} ${middle}$`))
  })

  it('orders a later column by the rows of its blockers so edges stay level', () => {
    const graph = graphOf([
      issue('e', { type: 'epic' }),
      issue('e.1', { parent: 'e' }),
      issue('e.2', { parent: 'e' }),
      issue('e.3', { parent: 'e', blockers: ['e.2'] }),
      issue('e.4', { parent: 'e', blockers: ['e.1'] }),
    ])
    const column = graph.nodes.filter(node => node.layer === 1).sort((a, b) => a.y - b.y).map(node => node.issue.id)
    expect(column).toEqual(['e.4', 'e.3'])
  })

  it('lays out an epic without dependencies as one column with no edges', () => {
    const graph = graphOf([
      issue('e', { type: 'epic' }),
      issue('e.1', { parent: 'e' }),
      issue('e.2', { parent: 'e' }),
      issue('e.3', { parent: 'e', status: 'closed' }),
    ])
    expect(graph.edges).toEqual([])
    expect(graph.nodes.map(node => node.layer)).toEqual([0, 0, 0])
    expect(new Set(graph.nodes.map(node => node.y)).size).toBe(3)
  })

  it('survives a blocking cycle, marking the edge that closes it', () => {
    const graph = graphOf([
      issue('e', { type: 'epic' }),
      issue('e.1', { parent: 'e', blockers: ['e.2'] }),
      issue('e.2', { parent: 'e', blockers: ['e.1'] }),
    ])
    expect(graph.nodes).toHaveLength(2)
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges.filter(edge => edge.back)).toHaveLength(1)
  })

  it('returns an empty canvas for an epic without children or an unknown id, and survives parent cycles', () => {
    expect(graphOf([issue('e', { type: 'epic' })])).toEqual({ nodes: [], edges: [], width: 0, height: 0 })
    expect(graphOf([issue('a', { parent: 'b' }), issue('b', { parent: 'a' })], 'a').nodes.map(node => node.issue.id)).toEqual(['b'])
  })
})

describe('issuesGraphLabel', () => {
  it('keeps short titles and ellipsises long ones within the limit', () => {
    expect(issuesGraphLabel('Short', 10)).toBe('Short')
    expect(issuesGraphLabel('A rather long title', 10)).toBe('A rather…')
    expect(issuesGraphLabel('A rather long title', 10).length).toBeLessThanOrEqual(10)
  })
})
