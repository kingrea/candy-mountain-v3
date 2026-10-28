import {
  ISSUE_TEXT_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  KNOWN_ISSUE_TYPES,
  type Issue,
  type IssueFields,
  type IssueType,
  type UpdateIssueRequest,
} from '@candy-mountain/shared'
import { issuesTypeMeta } from './issues-display'

export type IssuesEditableValues = Pick<
  IssueFields,
  'title' | 'description' | 'acceptanceCriteria' | 'notes' | 'type' | 'priority' | 'labels' | 'parentId' | 'assignee'
>
export type IssuesEditField = keyof IssuesEditableValues
export type IssuesEditDraft = Partial<IssuesEditableValues>

export const ISSUES_EDIT_FIELD_LABELS: Record<IssuesEditField | 'status', string> = {
  title: 'title',
  description: 'description',
  acceptanceCriteria: 'acceptance criteria',
  notes: 'notes',
  type: 'type',
  priority: 'priority',
  labels: 'labels',
  parentId: 'parent',
  assignee: 'assignee',
  status: 'status',
}

const TEXT_FIELDS = ['description', 'acceptanceCriteria', 'notes'] as const

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

// Markdown keeps its leading whitespace: an indented first line is a code block.
function textOrNull(value: string | null | undefined): string | null {
  return value?.trim() ? value.trimEnd() : null
}

export function issuesLabelsEqual(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every(label => right.has(label))
}

/** Rejected labels get a reason; the tracker splits label lists on commas. */
export function issuesLabelProblem(raw: string): string | null {
  const label = raw.trim()
  if (label === '') return 'A label cannot be empty'
  if (label.includes(',')) return 'Labels cannot contain commas'
  return null
}

export function issuesLabelsAdd(labels: readonly string[], raw: string): string[] {
  const label = raw.trim()
  if (issuesLabelProblem(label) || labels.includes(label)) return [...labels]
  return [...labels, label]
}

export function issuesLabelsRemove(labels: readonly string[], label: string): string[] {
  return labels.filter(candidate => candidate !== label)
}

/** Only fields that differ from `current` end up in the request, so an untouched field is never rewritten. */
export function issuesEditChanges(current: IssuesEditableValues, draft: IssuesEditDraft): UpdateIssueRequest {
  const changes: UpdateIssueRequest = {}

  if (draft.title !== undefined) {
    const title = draft.title.trim()
    if (title !== current.title) changes.title = title
  }
  for (const field of TEXT_FIELDS) {
    if (draft[field] === undefined) continue
    const next = textOrNull(draft[field])
    if (next !== textOrNull(current[field])) changes[field] = next
  }
  if (draft.type !== undefined && draft.type !== current.type) changes.type = draft.type
  if (draft.priority !== undefined && draft.priority !== current.priority) changes.priority = draft.priority
  if (draft.labels !== undefined) {
    const labels = [...new Set(draft.labels.map(label => label.trim()).filter(Boolean))]
    if (!issuesLabelsEqual(labels, current.labels)) changes.labels = labels
  }
  if (draft.parentId !== undefined) {
    const parentId = blankToNull(draft.parentId)
    if (parentId !== current.parentId) changes.parentId = parentId
  }
  if (draft.assignee !== undefined) {
    const assignee = blankToNull(draft.assignee)
    if (assignee !== blankToNull(current.assignee)) changes.assignee = assignee
  }
  return changes
}

/** Caught before the request so the user keeps their draft instead of meeting a 400. */
export function issuesEditProblem(changes: UpdateIssueRequest): string | null {
  if (changes.title !== undefined) {
    if (changes.title === '') return 'Title is required'
    if (changes.title.length > ISSUE_TITLE_MAX_LENGTH) return `Title must be at most ${ISSUE_TITLE_MAX_LENGTH} characters`
  }
  for (const field of TEXT_FIELDS) {
    const value = changes[field]
    if (value && value.length > ISSUE_TEXT_MAX_LENGTH) {
      return `${ISSUES_EDIT_FIELD_LABELS[field][0]!.toUpperCase()}${ISSUES_EDIT_FIELD_LABELS[field].slice(1)} must be at most ${ISSUE_TEXT_MAX_LENGTH} characters`
    }
  }
  for (const label of changes.labels ?? []) {
    const problem = issuesLabelProblem(label)
    if (problem) return problem
  }
  return null
}

/** An issue cannot hang under itself or anything below it. */
export function issuesParentCandidates(issues: readonly Issue[], issueId: string | null | undefined): Issue[] {
  if (!issueId) return [...issues]
  const excluded = new Set([issueId])
  let grew = true
  while (grew) {
    grew = false
    for (const issue of issues) {
      if (issue.parentId && excluded.has(issue.parentId) && !excluded.has(issue.id)) {
        excluded.add(issue.id)
        grew = true
      }
    }
  }
  return issues.filter(issue => !excluded.has(issue.id))
}

export interface IssuesTypeItem {
  label: string
  value: IssueType
  icon: string
}

/** Keeps a custom type from the tracker selectable so the select never shows blank. */
export function issuesTypeItems(current: IssueType): IssuesTypeItem[] {
  const types: IssueType[] = [...KNOWN_ISSUE_TYPES]
  if (!types.includes(current)) types.push(current)
  return types.map((type) => {
    const meta = issuesTypeMeta(type)
    return { label: meta.label, value: type, icon: meta.icon }
  })
}
