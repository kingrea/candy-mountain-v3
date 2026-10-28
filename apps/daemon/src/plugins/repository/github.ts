import { clampBranchListLimit, type RepositoryBranch } from '@candy-mountain/shared'
import { createHostClient, encodePath } from './client'
import type { HostOperations, HostOperationsOptions } from './operations'

const API = 'https://api.github.com'

// REST branch listings carry no dates, so recent-first ordering needs GraphQL.
const BRANCHES_QUERY = `query($owner: String!, $name: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: $first, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
      nodes { name target { oid ... on Commit { committedDate } } }
    }
  }
}`

interface GraphqlBranches {
  data?: { repository: { refs: { nodes: { name: string, target: { oid: string, committedDate?: string } }[] } | null } | null }
  errors?: { type?: string, message?: string }[]
}

export function githubOperations({ owner, repo, token, fetch, signal }: HostOperationsOptions): HostOperations {
  const client = createHostClient({
    host: 'github',
    baseUrl: API,
    token,
    subject: `${owner}/${repo}`,
    headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'candy-mountain' },
    errorMessage: body => (body as { message?: unknown } | null)?.message,
    fetch,
    signal,
  })
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  async function headSha(branch: string): Promise<string | undefined> {
    const response = await client.send(`${base}/git/ref/heads/${encodePath(branch)}`)
    if (response.status === 404) return undefined
    if (!response.ok) return client.fail(response)
    const ref = await client.parse<{ ref?: string, object?: { sha?: unknown } }>(response)
    if (ref.ref !== `refs/heads/${branch}`) return undefined
    if (typeof ref.object?.sha !== 'string') throw client.error('invalid_response', `GitHub sent a branch without a commit for ${client.subject}.`)
    return ref.object.sha
  }

  return {
    async defaultBranch() {
      const repository = await client.read<{ default_branch?: unknown }>(base)
      if (typeof repository.default_branch !== 'string') throw client.error('invalid_response', `GitHub sent no default branch for ${client.subject}.`)
      return repository.default_branch
    },

    async listBranches(limit) {
      const result = await client.read<GraphqlBranches>('/graphql', {
        method: 'POST',
        body: { query: BRANCHES_QUERY, variables: { owner, name: repo, first: clampBranchListLimit(limit) } },
      })
      if (result.errors?.length) {
        const [first] = result.errors
        const code = first?.type === 'NOT_FOUND' ? 'not_found' : first?.type === 'RATE_LIMITED' ? 'rate_limited' : first?.type === 'FORBIDDEN' ? 'forbidden' : 'host_error'
        throw client.error(code, `GitHub refused to list branches for ${client.subject}: ${first?.message ?? 'unknown error'}`)
      }
      const refs = result.data?.repository?.refs
      if (!refs) throw client.error('invalid_response', `GitHub sent no branches for ${client.subject}.`)
      return refs.nodes.map((node): RepositoryBranch => ({ name: node.name, sha: node.target.oid, committedAt: node.target.committedDate ?? null }))
    },

    async branchExists(branch) {
      return (await headSha(branch)) !== undefined
    },

    async fileExists(path, branch) {
      const sha = await headSha(branch)
      if (!sha) throw client.error('not_found', `Branch '${branch}' does not exist in ${client.subject}.`)
      const response = await client.send(`${base}/contents/${encodePath(path)}?ref=${sha}`)
      if (response.status === 404) return false
      if (!response.ok) return client.fail(response)
      const entry = await client.parse<unknown>(response)
      // A directory comes back as an array of its entries.
      if (Array.isArray(entry)) return false
      const type = (entry as { type?: unknown } | null)?.type
      return type === 'file' || type === 'symlink'
    },
  }
}
