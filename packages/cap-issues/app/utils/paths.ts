export function issuesPagePath(slug: string, issueId?: string): string {
  return issueId === undefined ? projectPath(slug, 'issues') : projectPath(slug, 'issues', encodeURIComponent(issueId))
}
