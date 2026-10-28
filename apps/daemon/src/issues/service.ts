import type { Issue, IssueComment, IssueDependency, IssueDetail, Project } from '@candy-mountain/shared'
import { sourcePath } from '../projects'
import { runBd, type BdRunner } from './bd-runner'
import { IssueError } from './errors'
import { asArray, toComment, toDependencies, toDependency, toFields, toLink } from './mapping'

export const ISSUE_LIST_TTL_MS = 3000

export type IssueProject = Pick<Project, 'id' | 'source'>

export interface IssuesService {
  list(project: IssueProject): Promise<Issue[]>
  show(project: IssueProject, id: string): Promise<IssueDetail>
  /** Outgoing edges of each id; ids the tracker does not know contribute nothing. */
  dependencies(project: IssueProject, ids: readonly string[]): Promise<IssueDependency[]>
  comments(project: IssueProject, id: string): Promise<IssueComment[]>
  /** Drops the cached list so the next read runs bd again; call after any write to the project's issues. */
  invalidate(projectId: string): void
}

export interface IssuesServiceOptions {
  run?: BdRunner
  ttlMs?: number
  now?: () => number
}

interface Snapshot {
  issues: Issue[]
  ready: Set<string>
}

interface CacheEntry {
  cwd: string
  snapshot: Promise<Snapshot>
  settledAt: number | null
}

export function createIssuesService(options: IssuesServiceOptions = {}): IssuesService {
  const run = options.run ?? runBd
  const ttlMs = options.ttlMs ?? ISSUE_LIST_TTL_MS
  const now = options.now ?? Date.now
  const cache = new Map<string, CacheEntry>()

  async function load(cwd: string): Promise<Snapshot> {
    const [listed, ready] = await Promise.all([
      // --limit 0 because bd's default limit would truncate parent epics out of large projects.
      run(cwd, ['list', '--all', '--limit', '0']),
      run(cwd, ['ready', '--limit', '0']),
    ])
    const readyIds = new Set(asArray(ready, 'bd ready').map(row => String(row.id)))
    const issues = asArray(listed, 'bd list').map(row => ({
      ...toFields(row, readyIds.has(String(row.id))),
      dependencies: toDependencies(row.dependencies),
    }))
    return { issues, ready: readyIds }
  }

  function snapshot(project: IssueProject): Promise<Snapshot> {
    const cwd = sourcePath(project.source)
    const cached = cache.get(project.id)
    if (cached && cached.cwd === cwd && (cached.settledAt === null || now() - cached.settledAt < ttlMs)) {
      return cached.snapshot
    }

    const entry: CacheEntry = { cwd, snapshot: load(cwd), settledAt: null }
    cache.set(project.id, entry)
    entry.snapshot.then(
      () => { entry.settledAt = now() },
      () => { if (cache.get(project.id) === entry) cache.delete(project.id) },
    )
    return entry.snapshot
  }

  async function dependenciesOf(cwd: string, id: string): Promise<IssueDependency[]> {
    try {
      const rows = asArray(await run(cwd, ['dep', 'list', id]), 'bd dep list')
      return rows.map(row => ({ issueId: id, dependsOnId: String(row.id), type: toLink(row).dependencyType }))
    }
    catch (error) {
      if (error instanceof IssueError && error.code === 'not_found') return []
      throw error
    }
  }

  return {
    async list(project) {
      return (await snapshot(project)).issues
    },

    async show(project, id) {
      const cwd = sourcePath(project.source)
      const [shown, dependents, current] = await Promise.all([
        run(cwd, ['show', id]),
        run(cwd, ['dep', 'list', id, '--direction', 'up']),
        snapshot(project),
      ])
      const row = asArray(shown, 'bd show')[0]
      if (!row) throw new IssueError('not_found', `No issue found matching ${id}`)
      const fields = toFields(row, current.ready.has(String(row.id)))
      return {
        ...fields,
        dependsOn: asArray(row.dependencies ?? [], 'bd show').map(toLink),
        dependents: asArray(dependents, 'bd dep list').map(toLink),
      }
    },

    async dependencies(project, ids) {
      const cwd = sourcePath(project.source)
      const unique = [...new Set(ids)]
      if (unique.length === 1) return dependenciesOf(cwd, unique[0]!)

      const rows = asArray(await run(cwd, ['dep', 'list', ...unique]), 'bd dep list')
      const edges = rows.map(toDependency)
      if (edges.every(edge => edge !== null)) return edges as IssueDependency[]
      // When only one of the ids resolves, bd prints that issue's neighbours without saying whose they are.
      return (await Promise.all(unique.map(id => dependenciesOf(cwd, id)))).flat()
    },

    async comments(project, id) {
      const rows = asArray(await run(sourcePath(project.source), ['comments', id]), 'bd comments')
      return rows.map(toComment)
    },

    invalidate(projectId) {
      cache.delete(projectId)
    },
  }
}

export const issuesService = createIssuesService()

export function invalidateIssueList(projectId: string): void {
  issuesService.invalidate(projectId)
}
