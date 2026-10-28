import {
  projectIssueClosePath,
  projectIssueCommentPath,
  projectIssueCommentsPath,
  projectIssuePath,
  projectIssuesBulkPath,
  projectIssuesPath,
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
    list: (slug: string) => $api<IssueListResponse>(projectIssuesPath(slug)),
    show: (slug: string, id: string) => $api<IssueResponse>(projectIssuePath(slug, id)),
    dependencies: (slug: string, ids: readonly string[]) =>
      $api<IssueDependencyListResponse>(`${projectIssuesPath(slug)}/dependencies`, { query: { ids: ids.join(',') } }),
    comments: (slug: string, id: string) => $api<IssueCommentListResponse>(projectIssueCommentsPath(slug, id)),

    create: (slug: string, body: CreateIssueRequest) =>
      $api<CreateIssueResponse>(projectIssuesPath(slug), { method: 'POST', body }),
    update: (slug: string, id: string, body: UpdateIssueRequest) =>
      $api<IssueResponse>(projectIssuePath(slug, id), { method: 'PATCH', body }),
    close: (slug: string, id: string, body: CloseIssueRequest = {}) =>
      $api<IssueResponse>(projectIssueClosePath(slug, id), { method: 'POST', body }),
    bulkUpdate: (slug: string, body: BulkUpdateIssuesRequest) =>
      $api<BulkUpdateIssuesResponse>(projectIssuesBulkPath(slug), { method: 'POST', body }),
    addComment: (slug: string, id: string, text: string) =>
      $api<IssueCommentResponse>(projectIssueCommentsPath(slug, id), { method: 'POST', body: { text } }),
    editComment: (slug: string, id: string, commentId: string, text: string) =>
      $api<IssueCommentResponse>(projectIssueCommentPath(slug, id, commentId), { method: 'PATCH', body: { text } }),
  }
}
