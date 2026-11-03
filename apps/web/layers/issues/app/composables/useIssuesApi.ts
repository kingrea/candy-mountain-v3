import {
  workspaceIssueClosePath,
  workspaceIssueCommentPath,
  workspaceIssueCommentsPath,
  workspaceIssuePath,
  workspaceIssuesBulkPath,
  workspaceIssuesPath,
  type BulkUpdateIssuesRequest,
  type BulkUpdateIssuesResponse,
  type CloseIssueRequest,
  type CreateIssueRequest,
  type CreateIssueResponse,
  type IssueCommentListResponse,
  type IssueCommentResponse,
  type IssueDependencyListResponse,
  type IssueListResponse,
  type IssueResponse,
  type UpdateIssueRequest,
} from '@candy-mountain/shared'

export type IssuesApi = ReturnType<typeof useIssuesApi>

export function useIssuesApi() {
  const { $api } = useNuxtApp()

  return {
    list: (slug: string) => $api<IssueListResponse>(workspaceIssuesPath(slug)),
    show: (slug: string, id: string) => $api<IssueResponse>(workspaceIssuePath(slug, id)),
    dependencies: (slug: string, ids: readonly string[]) =>
      $api<IssueDependencyListResponse>(`${workspaceIssuesPath(slug)}/dependencies`, { query: { ids: ids.join(',') } }),
    comments: (slug: string, id: string) => $api<IssueCommentListResponse>(workspaceIssueCommentsPath(slug, id)),

    create: (slug: string, body: CreateIssueRequest) =>
      $api<CreateIssueResponse>(workspaceIssuesPath(slug), { method: 'POST', body }),
    update: (slug: string, id: string, body: UpdateIssueRequest) =>
      $api<IssueResponse>(workspaceIssuePath(slug, id), { method: 'PATCH', body }),
    close: (slug: string, id: string, body: CloseIssueRequest = {}) =>
      $api<IssueResponse>(workspaceIssueClosePath(slug, id), { method: 'POST', body }),
    bulkUpdate: (slug: string, body: BulkUpdateIssuesRequest) =>
      $api<BulkUpdateIssuesResponse>(workspaceIssuesBulkPath(slug), { method: 'POST', body }),
    addComment: (slug: string, id: string, text: string) =>
      $api<IssueCommentResponse>(workspaceIssueCommentsPath(slug, id), { method: 'POST', body: { text } }),
    editComment: (slug: string, id: string, commentId: string, text: string) =>
      $api<IssueCommentResponse>(workspaceIssueCommentPath(slug, id, commentId), { method: 'PATCH', body: { text } }),
  }
}
