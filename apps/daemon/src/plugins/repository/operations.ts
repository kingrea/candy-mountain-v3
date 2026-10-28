import type { PluginSecrets, RepositoryBranch, RepositoryBranchList, RepositoryHost } from '@candy-mountain/shared'
import type { RepositoryConfig } from '../types/repository'
import { bitbucketOperations } from './bitbucket'
import { githubOperations } from './github'

export interface RepositoryOperations {
  readonly host: RepositoryHost
  /** Most recently committed first; `limit` is clamped to 1..100 (default 30). */
  listBranches(options?: { limit?: number }): Promise<RepositoryBranch[]>
  /** Throws a not_found RepositoryHostError when the branch itself is missing. */
  fileExists(path: string, branch: string): Promise<boolean>
  branchExists(branch: string): Promise<boolean>
  /** The configured default branch, or the host's when none is configured. */
  getDefaultBranch(): Promise<string>
}

export interface RepositoryOperationsOptions {
  signal?: AbortSignal
  fetch?: typeof fetch
}

export interface HostOperationsOptions extends RepositoryOperationsOptions {
  owner: string
  repo: string
  token: string | undefined
}

export interface HostOperations {
  defaultBranch(): Promise<string>
  listBranches(limit: number | undefined): Promise<RepositoryBranch[]>
  branchExists(branch: string): Promise<boolean>
  fileExists(path: string, branch: string): Promise<boolean>
}

const HOSTS: Record<RepositoryHost, (options: HostOperationsOptions) => HostOperations> = {
  github: githubOperations,
  bitbucket: bitbucketOperations,
}

/** Never throws itself; each operation throws RepositoryHostError with the token redacted. */
export function createRepositoryOperations(config: RepositoryConfig, secrets: PluginSecrets<'token'>, options: RepositoryOperationsOptions = {}): RepositoryOperations {
  const host = HOSTS[config.host]({ ...options, owner: config.owner, repo: config.repo, token: secrets.get('token') })
  return Object.freeze({
    host: config.host,
    listBranches: ({ limit }: { limit?: number } = {}) => host.listBranches(limit),
    fileExists: (path: string, branch: string) => host.fileExists(path, branch),
    branchExists: (branch: string) => host.branchExists(branch),
    getDefaultBranch: async () => config.defaultBranch ?? host.defaultBranch(),
  })
}

export async function listRepositoryBranches(operations: RepositoryOperations, limit?: number): Promise<RepositoryBranchList> {
  const [defaultBranch, branches] = await Promise.all([operations.getDefaultBranch(), operations.listBranches({ limit })])
  return { defaultBranch, branches }
}
