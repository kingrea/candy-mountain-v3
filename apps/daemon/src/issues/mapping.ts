import type { IssueComment, IssueDependency, IssueFields, IssueLink, IssueSummary } from '@candy-mountain/shared'
import { IssueError } from './errors'

type Raw = Record<string, unknown>

export function asArray(payload: unknown, command: string): Raw[] {
  if (payload === null) return []
  if (!Array.isArray(payload)) throw new IssueError('tracker_failed', `${command} returned an unexpected shape`)
  return payload.filter((item): item is Raw => typeof item === 'object' && item !== null)
}

function text(raw: Raw, key: string): string | null {
  const value = raw[key]
  return typeof value === 'string' && value !== '' ? value : null
}

function count(raw: Raw, key: string): number {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function toSummary(raw: Raw): IssueSummary {
  return {
    id: text(raw, 'id') ?? '',
    title: text(raw, 'title') ?? '',
    status: text(raw, 'status') ?? 'open',
    priority: count(raw, 'priority'),
    type: text(raw, 'issue_type') ?? 'task',
  }
}

export function toFields(raw: Raw, ready: boolean): IssueFields {
  const labels = Array.isArray(raw.labels) ? raw.labels.filter((label): label is string => typeof label === 'string') : []
  return {
    ...toSummary(raw),
    description: text(raw, 'description'),
    acceptanceCriteria: text(raw, 'acceptance_criteria'),
    notes: text(raw, 'notes'),
    assignee: text(raw, 'assignee'),
    owner: text(raw, 'owner'),
    labels,
    parentId: text(raw, 'parent'),
    createdAt: text(raw, 'created_at'),
    createdBy: text(raw, 'created_by'),
    updatedAt: text(raw, 'updated_at'),
    startedAt: text(raw, 'started_at'),
    closedAt: text(raw, 'closed_at'),
    closeReason: text(raw, 'close_reason'),
    commentCount: count(raw, 'comment_count'),
    ready,
  }
}

/** Maps a `{ issue_id, depends_on_id, type }` edge record. */
export function toDependency(raw: Raw): IssueDependency | null {
  const issueId = text(raw, 'issue_id')
  const dependsOnId = text(raw, 'depends_on_id')
  if (issueId === null || dependsOnId === null) return null
  return { issueId, dependsOnId, type: text(raw, 'type') ?? 'blocks' }
}

export function toDependencies(value: unknown): IssueDependency[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => (typeof item === 'object' && item !== null ? [toDependency(item as Raw)] : []))
    .filter((dep): dep is IssueDependency => dep !== null)
}

/** Maps an issue row that carries `dependency_type`, as `bd show` and single-id `bd dep list` print. */
export function toLink(raw: Raw): IssueLink {
  return { ...toSummary(raw), dependencyType: text(raw, 'dependency_type') ?? 'blocks' }
}

export function toComment(raw: Raw): IssueComment {
  return {
    id: String(raw.id ?? ''),
    issueId: text(raw, 'issue_id') ?? '',
    author: text(raw, 'author'),
    text: typeof raw.text === 'string' ? raw.text : '',
    createdAt: text(raw, 'created_at'),
  }
}
