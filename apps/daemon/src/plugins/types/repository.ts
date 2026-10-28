import { clampBranchListLimit, validatePluginConfig, type PluginConfigOf, type RepositoryBranchList, type RepositoryErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { PluginActionError } from '../actions'
import { definePluginType } from '../definition'
import { RepositoryHostError } from '../repository/client'
import { createRepositoryOperations, listRepositoryBranches } from '../repository/operations'

// Every host failure is the upstream's, never the caller's, hence gateway statuses.
const ACTION_STATUS: Record<RepositoryErrorCode, ContentfulStatusCode> = {
  no_token: 409,
  unauthorized: 502,
  forbidden: 502,
  not_found: 502,
  host_error: 502,
  invalid_response: 502,
  unavailable: 502,
  rate_limited: 503,
}

function actionError(error: unknown): unknown {
  if (!(error instanceof RepositoryHostError)) return error
  const headers: Record<string, string> = error.retryAfterSeconds === undefined ? {} : { 'retry-after': String(error.retryAfterSeconds) }
  return new PluginActionError(ACTION_STATUS[error.code], `repository_${error.code}`, error.message, headers)
}

export const repositoryPluginType = definePluginType({
  id: 'repository',
  name: 'Repository',
  description: 'The project\'s remote repository on GitHub or Bitbucket.',
  reach: [
    'Read the repository and list its branches.',
    'Check whether files exist on a branch.',
  ],
  scopes: ['project'],
  singleInstance: true,
  configFields: [
    { kind: 'select', name: 'host', label: 'Host', options: [{ value: 'github', label: 'GitHub' }, { value: 'bitbucket', label: 'Bitbucket' }], required: true },
    { kind: 'string', name: 'owner', label: 'Owner', description: 'The GitHub user or organisation, or the Bitbucket workspace.', required: true, pattern: '[A-Za-z0-9][A-Za-z0-9._-]*' },
    { kind: 'string', name: 'repo', label: 'Repository', description: 'The repository name (its slug on Bitbucket).', required: true, pattern: '[A-Za-z0-9._-]+' },
    { kind: 'string', name: 'defaultBranch', label: 'Default branch', description: 'Leave blank to use the host\'s default branch.', placeholder: 'main', pattern: '[^\\s~^:?*\\[\\\\]+' },
  ],
  secretFields: [
    { name: 'token', label: 'Token', description: 'A token that can read the repository: a GitHub fine-grained token or a Bitbucket repository or workspace access token.', required: true },
  ],
  async healthCheck({ config, secrets, signal }) {
    const repository = createRepositoryOperations(config, secrets, { signal })
    const defaultBranch = await repository.getDefaultBranch()
    await repository.listBranches({ limit: 1 })
    if (config.defaultBranch && !(await repository.branchExists(config.defaultBranch))) {
      return { healthy: false, reason: `Default branch '${config.defaultBranch}' does not exist in ${config.owner}/${config.repo}.` }
    }
    return { healthy: true, detail: `Can read ${config.owner}/${config.repo} and list its branches; default branch '${defaultBranch}'.` }
  },
  actions: {
    branches: {
      method: 'GET',
      async run({ config, secrets, request, signal }): Promise<RepositoryBranchList> {
        const limit = clampBranchListLimit(new URL(request.url).searchParams.get('limit') ?? undefined)
        try {
          return await listRepositoryBranches(createRepositoryOperations(config, secrets, { signal }), limit)
        }
        catch (error) {
          throw actionError(error)
        }
      },
    },
  },
})

export type RepositoryConfig = PluginConfigOf<typeof repositoryPluginType.configFields>

/** Narrows a stored instance config, throwing when it no longer validates. */
export function repositoryConfig(config: unknown): RepositoryConfig {
  const result = validatePluginConfig(repositoryPluginType.configFields, config)
  if (!result.ok) throw new Error(`Invalid repository config: ${result.errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' ')}`)
  return result.config as RepositoryConfig
}
