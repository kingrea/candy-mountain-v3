import { clampBranchListLimit, type RepositoryBranch } from '@candy-mountain/shared'
import { createHostClient, encodePath } from './client'
import type { HostOperations, HostOperationsOptions } from './operations'

const API = 'https://api.bitbucket.org/2.0'

interface BitbucketBranches {
  values?: { name: string, target?: { hash?: string, date?: string } }[]
}

export function bitbucketOperations({ owner, repo, token, fetch, signal }: HostOperationsOptions): HostOperations {
  const client = createHostClient({
    host: 'bitbucket',
    baseUrl: API,
    token,
    subject: `${owner}/${repo}`,
    headers: { Accept: 'application/json' },
    errorMessage: body => (body as { error?: { message?: unknown } } | null)?.error?.message,
    fetch,
    signal,
  })
  const base = `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  async function headSha(branch: string): Promise<string | undefined> {
    // Filtering by name sidesteps the path ambiguity of branch names that contain slashes.
    const q = encodeURIComponent(`name = "${branch.replace(/["\\]/g, '\\$&')}"`)
    const page = await client.read<BitbucketBranches>(`${base}/refs/branches?q=${q}&pagelen=1`)
    const match = page.values?.find(value => value.name === branch)
    if (!match) return undefined
    if (typeof match.target?.hash !== 'string') throw client.error('invalid_response', `Bitbucket sent a branch without a commit for ${client.subject}.`)
    return match.target.hash
  }

  return {
    async defaultBranch() {
      const repository = await client.read<{ mainbranch?: { name?: unknown } | null }>(base)
      const name = repository.mainbranch?.name
      if (typeof name !== 'string') throw client.error('invalid_response', `Bitbucket sent no main branch for ${client.subject}.`)
      return name
    },

    async listBranches(limit) {
      const page = await client.read<BitbucketBranches>(`${base}/refs/branches?sort=-target.date&pagelen=${clampBranchListLimit(limit)}`)
      if (!Array.isArray(page.values)) throw client.error('invalid_response', `Bitbucket sent no branches for ${client.subject}.`)
      return page.values.map((value): RepositoryBranch => ({ name: value.name, sha: value.target?.hash ?? '', committedAt: value.target?.date ?? null }))
    },

    async branchExists(branch) {
      return (await headSha(branch)) !== undefined
    },

    async fileExists(path, branch) {
      const sha = await headSha(branch)
      if (!sha) throw client.error('not_found', `Branch '${branch}' does not exist in ${client.subject}.`)
      const response = await client.send(`${base}/src/${sha}/${encodePath(path)}?format=meta`)
      if (response.status === 404) return false
      if (!response.ok) return client.fail(response)
      const entry = await client.parse<{ type?: unknown } | null>(response)
      return entry?.type === 'commit_file'
    },
  }
}
