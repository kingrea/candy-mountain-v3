import { PROJECTS_PATH } from './projects'

export function projectIssuesPath(projectSlug: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(projectSlug)}/issues`
}

export function projectIssuePath(projectSlug: string, issueId: string): string {
  return `${projectIssuesPath(projectSlug)}/${encodeURIComponent(issueId)}`
}

/** Server-sent event stream that emits ISSUE_CHANGED_EVENT whenever the project's issues change on disk. */
export function projectIssueEventsPath(projectSlug: string): string {
  return `${projectIssuesPath(projectSlug)}/events`
}

export const ISSUE_CHANGED_EVENT = 'changed'

export interface IssueChangedEvent {
  projectId: string
}

export const ISSUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const MAX_DEPENDENCY_IDS = 200

// The issue tracker may grow statuses and types, so unknown strings pass through untouched.
export const KNOWN_ISSUE_STATUSES = ['open', 'in_progress', 'blocked', 'deferred', 'closed'] as const
export type IssueStatus = (typeof KNOWN_ISSUE_STATUSES)[number] | (string & {})

export const KNOWN_ISSUE_TYPES = ['bug', 'feature', 'task', 'epic', 'chore', 'decision'] as const
export type IssueType = (typeof KNOWN_ISSUE_TYPES)[number] | (string & {})

export const KNOWN_DEPENDENCY_TYPES = ['blocks', 'parent-child', 'related', 'discovered-from'] as const
export type IssueDependencyType = (typeof KNOWN_DEPENDENCY_TYPES)[number] | (string & {})

/** Edge: `issueId` depends on `dependsOnId`. */
export interface IssueDependency {
  issueId: string
  dependsOnId: string
  type: IssueDependencyType
}

export interface IssueSummary {
  id: string
  title: string
  status: IssueStatus
  /** 0 (highest) to 4. */
  priority: number
  type: IssueType
}

/** A neighbouring issue seen from another issue, with the kind of edge between them. */
export interface IssueLink extends IssueSummary {
  dependencyType: IssueDependencyType
}

export interface IssueFields extends IssueSummary {
  description: string | null
  acceptanceCriteria: string | null
  notes: string | null
  assignee: string | null
  owner: string | null
  labels: string[]
  parentId: string | null
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  startedAt: string | null
  closedAt: string | null
  closeReason: string | null
  commentCount: number
  /** Claimable now, as reported by the tracker's own ready query (in-progress issues are never ready). */
  ready: boolean
}

export interface Issue extends IssueFields {
  /** Outgoing edges, including the parent-child edge to `parentId`. */
  dependencies: IssueDependency[]
}

export interface IssueDetail extends IssueFields {
  /** Issues this one depends on, including its parent. */
  dependsOn: IssueLink[]
  /** Issues depending on this one, including its children (`dependencyType` 'parent-child'). */
  dependents: IssueLink[]
}

export interface IssueComment {
  id: string
  issueId: string
  author: string | null
  text: string
  createdAt: string | null
}

export interface IssueListResponse {
  issues: Issue[]
}

export interface IssueResponse {
  issue: IssueDetail
}

export interface IssueDependencyListResponse {
  dependencies: IssueDependency[]
}

export interface IssueCommentListResponse {
  comments: IssueComment[]
}

export function projectIssueCommentsPath(projectSlug: string, issueId: string): string {
  return `${projectIssuePath(projectSlug, issueId)}/comments`
}

export function projectIssueCommentPath(projectSlug: string, issueId: string, commentId: string): string {
  return `${projectIssueCommentsPath(projectSlug, issueId)}/${encodeURIComponent(commentId)}`
}

export function projectIssueClosePath(projectSlug: string, issueId: string): string {
  return `${projectIssuePath(projectSlug, issueId)}/close`
}

export function projectIssuesBulkPath(projectSlug: string): string {
  return `${projectIssuesPath(projectSlug)}/bulk`
}

export const ISSUE_COMMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
export const MAX_BULK_ISSUE_IDS = 200
export const ISSUE_TITLE_MAX_LENGTH = 500
// Free text travels to the tracker as a command-line argument, which the OS caps at 128 KiB.
export const ISSUE_TEXT_MAX_LENGTH = 30_000

/** `null` or an empty string clears an optional text field. */
export interface CreateIssueRequest {
  title: string
  type?: IssueType
  priority?: number
  labels?: string[]
  parentId?: string | null
  description?: string | null
  acceptanceCriteria?: string | null
  notes?: string | null
  assignee?: string | null
  /** Ids the new issue depends on, as blocking edges. */
  dependsOn?: string[]
}

export interface CreateIssueResponse {
  issue: IssueDetail
  /** Dependencies the tracker refused after the issue was created, with its reason. */
  warnings: string[]
}

/** Omitted fields stay as they are; `null` or `''` clears a text field and a `null` parent detaches the issue. */
export interface UpdateIssueRequest {
  title?: string
  description?: string | null
  acceptanceCriteria?: string | null
  notes?: string | null
  type?: IssueType
  priority?: number
  /** Replaces the whole label set. */
  labels?: string[]
  parentId?: string | null
  assignee?: string | null
  status?: IssueStatus
}

export interface CloseIssueRequest {
  reason?: string | null
  /** Closes despite open children or open blockers, which bd otherwise refuses. */
  force?: boolean
}

export interface BulkIssueChanges {
  status?: IssueStatus
  priority?: number
  type?: IssueType
  assignee?: string | null
  parentId?: string | null
  addLabels?: string[]
  removeLabels?: string[]
}

export interface BulkUpdateIssuesRequest {
  ids: string[]
  changes: BulkIssueChanges
}

export interface BulkUpdateIssuesResponse {
  updatedIds: string[]
  /** Ids the tracker did not know; the rest were still updated. */
  missingIds: string[]
}

export interface IssueCommentRequest {
  text: string
}

export interface IssueCommentResponse {
  comment: IssueComment
}

export const ISSUE_ERROR_CODES = [
  'invalid_request',
  'not_found',
  'no_issue_tracker',
  'tracker_unavailable',
  'tracker_failed',
  'tracker_timeout',
] as const
export type IssueErrorCode = (typeof ISSUE_ERROR_CODES)[number]
