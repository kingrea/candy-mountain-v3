import type { IssueDependency } from '@candy-mountain/shared'

export interface IssuesOrderable {
  id: string
  title: string
  dependencies: readonly IssueDependency[]
}

// A fixed locale keeps server-rendered and hydrated order identical.
const titleOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

function idSequence(id: string): number[] {
  const parts = id.split('.').slice(1)
  const numbers = parts.map(part => Number.parseInt(part, 10))
  return parts.length > 0 && numbers.every(value => Number.isFinite(value)) ? numbers : []
}

function compareSequences(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return b.length - a.length

  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!
  }

  return a.length - b.length
}

// The parent-child edge is membership, not order.
function blockerIds(issue: IssuesOrderable): string[] {
  return issue.dependencies.filter(dependency => dependency.type === 'blocks').map(dependency => dependency.dependsOnId)
}

/**
 * Only issues created under the hierarchical id scheme carry their intended sequence, so numeric
 * title order ("Phase 2", "Phase 2b", "Phase 10") is the fallback before blockers pull dependants down.
 */
export function issuesSortSiblings<T extends IssuesOrderable>(issues: readonly T[]): T[] {
  const ranked = [...issues].sort((a, b) => {
    const sequences = compareSequences(idSequence(a.id), idSequence(b.id))
    if (sequences !== 0) return sequences

    const titles = titleOrder.compare(a.title, b.title)
    return titles !== 0 ? titles : a.id.localeCompare(b.id, 'en')
  })

  const siblingIds = new Set(ranked.map(issue => issue.id))
  const settled = new Set<string>()
  const ordered: T[] = []

  while (ranked.length > 0) {
    const ready = ranked.findIndex(issue => blockerIds(issue).every(id => !siblingIds.has(id) || settled.has(id)))
    // A blocking cycle leaves nothing ready; take the head so every issue still renders.
    const [next] = ranked.splice(ready === -1 ? 0 : ready, 1) as [T]
    settled.add(next.id)
    ordered.push(next)
  }

  return ordered
}
