import {
  ISSUE_COMMENT_ID_PATTERN,
  ISSUE_ID_PATTERN,
  ISSUE_TEXT_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  MAX_BULK_ISSUE_IDS,
  type BulkIssueChanges,
  type BulkUpdateIssuesRequest,
  type CloseIssueRequest,
  type CreateIssueRequest,
  type IssueCommentRequest,
  type UpdateIssueRequest,
} from '@candy-mountain/shared'
import { IssueError } from './errors'

type Body = Record<string, unknown>

const NAME_MAX_LENGTH = 200
const KEYWORD = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

function invalid(message: string): never {
  throw new IssueError('invalid_request', message)
}

function object(value: unknown, what = 'Request body'): Body {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(`${what} must be a JSON object`)
  return value as Body
}

function known(body: Body, keys: readonly string[], what = 'Request body'): void {
  const unknown = Object.keys(body).filter(key => !keys.includes(key))
  if (unknown.length > 0) invalid(`${what} has unknown fields: ${unknown.join(', ')}`)
}

export function issueId(raw: unknown, key = 'id'): string {
  // Ids go to bd as arguments, so anything that could read as a flag is refused.
  if (typeof raw !== 'string' || !ISSUE_ID_PATTERN.test(raw)) invalid(`Invalid issue id in ${key}: ${String(raw)}`)
  return raw
}

export function commentId(raw: string): string {
  if (!ISSUE_COMMENT_ID_PATTERN.test(raw)) invalid(`Invalid comment id: ${raw}`)
  return raw
}

function title(body: Body): string | undefined {
  const value = body.title
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') invalid('title must be a non-empty string')
  if (value.length > ISSUE_TITLE_MAX_LENGTH) invalid(`title must be at most ${ISSUE_TITLE_MAX_LENGTH} characters`)
  return value.trim()
}

function text(body: Body, key: string, max = ISSUE_TEXT_MAX_LENGTH): string | null | undefined {
  const value = body[key]
  if (value === undefined || value === null) return value
  if (typeof value !== 'string') invalid(`${key} must be a string or null`)
  if (value.length > max) invalid(`${key} must be at most ${max} characters`)
  return value
}

function keyword(body: Body, key: string): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !KEYWORD.test(value)) invalid(`${key} must be a word of letters, digits, _ or - that starts with a letter or digit`)
  return value
}

function priority(body: Body): number | undefined {
  const value = body.priority
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 4) invalid('priority must be an integer from 0 to 4')
  return value
}

function labels(body: Body, key: string): string[] | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) invalid(`${key} must be an array of strings`)
  return [...new Set(value.map((label) => {
    // bd splits label flags on commas.
    if (typeof label !== 'string' || label.trim() === '' || label.includes(',') || label.length > NAME_MAX_LENGTH) {
      invalid(`${key} must hold non-empty labels without commas`)
    }
    return label.trim()
  }))]
}

function parentId(body: Body): string | null | undefined {
  const value = body.parentId
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  return issueId(value, 'parentId')
}

function assignee(body: Body): string | null | undefined {
  const value = text(body, 'assignee', NAME_MAX_LENGTH)
  if (value === undefined) return undefined
  return value?.trim() || null
}

function ids(value: unknown, key: string, max: number): string[] {
  if (!Array.isArray(value)) invalid(`${key} must be an array of issue ids`)
  if (value.length > max) invalid(`${key} holds at most ${max} ids`)
  return [...new Set(value.map(id => issueId(id, key)))]
}

const CREATE_KEYS = ['title', 'type', 'priority', 'labels', 'parentId', 'description', 'acceptanceCriteria', 'notes', 'assignee', 'dependsOn'] as const

export function parseCreateIssue(value: unknown): CreateIssueRequest {
  const body = object(value)
  known(body, CREATE_KEYS)
  const parsedTitle = title(body)
  if (parsedTitle === undefined) invalid('title is required')
  return {
    title: parsedTitle,
    type: keyword(body, 'type'),
    priority: priority(body),
    labels: labels(body, 'labels'),
    parentId: parentId(body),
    description: text(body, 'description'),
    acceptanceCriteria: text(body, 'acceptanceCriteria'),
    notes: text(body, 'notes'),
    assignee: assignee(body),
    dependsOn: body.dependsOn === undefined ? undefined : ids(body.dependsOn, 'dependsOn', MAX_BULK_ISSUE_IDS),
  }
}

const UPDATE_KEYS = ['title', 'description', 'acceptanceCriteria', 'notes', 'type', 'priority', 'labels', 'parentId', 'assignee', 'status'] as const

export function parseUpdateIssue(value: unknown): UpdateIssueRequest {
  const body = object(value)
  known(body, UPDATE_KEYS)
  const request: UpdateIssueRequest = {
    title: title(body),
    description: text(body, 'description'),
    acceptanceCriteria: text(body, 'acceptanceCriteria'),
    notes: text(body, 'notes'),
    type: keyword(body, 'type'),
    priority: priority(body),
    labels: labels(body, 'labels'),
    parentId: parentId(body),
    assignee: assignee(body),
    status: keyword(body, 'status'),
  }
  if (Object.values(request).every(field => field === undefined)) invalid(`Pass at least one of: ${UPDATE_KEYS.join(', ')}`)
  return request
}

export function parseCloseIssue(value: unknown): CloseIssueRequest {
  const body = object(value ?? {})
  known(body, ['reason', 'force'])
  if (body.force !== undefined && typeof body.force !== 'boolean') invalid('force must be a boolean')
  return { reason: text(body, 'reason'), force: body.force }
}

const BULK_CHANGE_KEYS = ['status', 'priority', 'type', 'assignee', 'parentId', 'addLabels', 'removeLabels'] as const

export function parseBulkUpdate(value: unknown): BulkUpdateIssuesRequest {
  const body = object(value)
  known(body, ['ids', 'changes'])
  const parsedIds = ids(body.ids, 'ids', MAX_BULK_ISSUE_IDS)
  if (parsedIds.length === 0) invalid('ids must hold at least one issue id')
  const raw = object(body.changes, 'changes')
  known(raw, BULK_CHANGE_KEYS, 'changes')
  const changes: BulkIssueChanges = {
    status: keyword(raw, 'status'),
    priority: priority(raw),
    type: keyword(raw, 'type'),
    assignee: assignee(raw),
    parentId: parentId(raw),
    addLabels: labels(raw, 'addLabels'),
    removeLabels: labels(raw, 'removeLabels'),
  }
  if (Object.values(changes).every(field => field === undefined || (Array.isArray(field) && field.length === 0))) {
    invalid(`changes must set at least one of: ${BULK_CHANGE_KEYS.join(', ')}`)
  }
  return { ids: parsedIds, changes }
}

export function parseComment(value: unknown): IssueCommentRequest {
  const body = object(value)
  known(body, ['text'])
  const parsed = text(body, 'text')
  if (typeof parsed !== 'string' || parsed.trim() === '') invalid('text must be a non-empty string')
  return { text: parsed }
}
