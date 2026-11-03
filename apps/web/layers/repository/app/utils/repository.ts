import { repositoryPath, repositoryVerifyPath, type Workspace, type Repository, type RepositoryResponse, type RepositoryVerification } from '@candy-mountain/shared'
import type { Component } from 'vue'
import * as z from 'zod'

export function repositoryIsAbsoluteish(path: string): boolean {
  return path.startsWith('/') || path === '~' || path.startsWith('~/')
}

export const REPOSITORY_PATH_SCHEMA = z.string().trim()
  .min(1, 'Path is required')
  .refine(repositoryIsAbsoluteish, 'Use an absolute path, such as /home/you/code/app or ~/code/app')

/** API error codes the daemon answers for a bad path; the form shows them on the path field. */
export const REPOSITORY_PATH_ERROR_CODES = ['invalid_path', 'path_not_found'] as const

export function repositorySourceRequest(path: string) {
  return { source: { kind: 'local-path' as const, path } }
}

export interface RepositoryFact {
  id: string
  label: string
  icon: string
  color: 'error' | 'warning' | 'success' | 'neutral'
  hint: string
}

export function repositoryVerificationFacts(v: RepositoryVerification): RepositoryFact[] {
  if (!v.pathExists) {
    return [{ id: 'path', label: 'Path not found', icon: 'i-lucide-folder-x', color: 'error', hint: 'The path is missing or is not a directory.' }]
  }

  const issues: RepositoryFact = v.hasBeads
    ? { id: 'issues', label: 'Issue tracker', icon: 'i-lucide-list-checks', color: 'success', hint: 'A .beads directory was found.' }
    : { id: 'issues', label: 'No issue tracker', icon: 'i-lucide-list-x', color: 'warning', hint: 'No .beads directory at this path.' }

  let git: RepositoryFact
  if (!v.isGitRepo) {
    git = { id: 'git', label: 'Not a git repo', icon: 'i-lucide-git-branch', color: 'neutral', hint: 'The path is not inside a git work tree.' }
  }
  else if (v.hasRemote) {
    git = { id: 'git', label: `Remote: ${v.remoteName}`, icon: 'i-lucide-git-branch', color: 'success', hint: v.remoteUrl ?? '' }
  }
  else {
    git = { id: 'git', label: 'No git remote', icon: 'i-lucide-git-branch', color: 'warning', hint: 'A git repo with no remotes.' }
  }

  return [issues, git]
}

export function repositoryVerificationSummary(v: RepositoryVerification): string {
  if (!v.pathExists) return 'Path not found.'
  const issues = v.hasBeads ? 'issue tracker found' : 'no issue tracker'
  const git = !v.isGitRepo ? 'not a git repo' : v.hasRemote ? `git remote ${v.remoteName}` : 'no git remote'
  return `Path checked: ${issues}, ${git}.`
}

export function repositorySaveNote(repository: Repository): ProjectFormSaveNote {
  return {
    description: repositoryVerificationSummary(repository.verification),
    color: repository.verification.pathExists ? 'success' : 'warning',
  }
}

export type RepositoryApi = <T>(path: string, options: { method: 'POST' | 'PUT', body?: Record<string, unknown> }) => Promise<T>

/** Sets the saved project's repository, checking the path, and answers the toast note for the save. */
export async function repositorySave(api: RepositoryApi, project: Workspace, path: string): Promise<ProjectFormSaveNote> {
  const response = await api<RepositoryResponse>(repositoryPath(project.slug), { method: 'PUT', body: repositorySourceRequest(path) })
  return repositorySaveNote(response.repository)
}

/** Re-checks a saved project's path and answers the toast the projects page shows. */
export async function repositoryRecheck(api: RepositoryApi, project: Workspace): Promise<ProjectRowActionNote> {
  const response = await api<RepositoryResponse>(repositoryVerifyPath(project.slug), { method: 'POST' })
  return { title: `Checked ${project.name}`, description: repositoryVerificationSummary(response.repository.verification) }
}

/** The path is written through the repository API once the project is saved; the field component fills it from the stored repository. */
export function repositoryFormField(component: Component, api: RepositoryApi): ProjectFormField<string> {
  return {
    name: 'path',
    component,
    schema: REPOSITORY_PATH_SCHEMA,
    initial: () => '',
    errorCodes: REPOSITORY_PATH_ERROR_CODES,
    afterSave: (project, { value }) => repositorySave(api, project, value),
    description: { create: 'Register a local codebase.', edit: 'Saving re-checks the path.' },
  }
}

export function repositoryRecheckAction(api: RepositoryApi): ProjectRowAction {
  return { id: 'repository', label: 'Re-check path', icon: 'i-lucide-refresh-cw', run: project => repositoryRecheck(api, project) }
}
