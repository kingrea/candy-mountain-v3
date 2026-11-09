import type { Workspace } from '@crab-shack/platform-sdk'
import type { Repository, RepositoryVerification } from '../../src/wire'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import {
  repositoryFormField,
  repositoryRecheck,
  repositoryRecheckAction,
  repositorySave,
  repositorySaveNote,
  repositoryVerificationFacts,
  repositoryVerificationSummary,
} from '../../app/utils/repository'

const checked = (overrides: Partial<RepositoryVerification> = {}): RepositoryVerification => ({
  checkedAt: '2026-11-03T10:00:00.000Z',
  pathExists: true,
  hasBeads: true,
  isGitRepo: true,
  hasRemote: true,
  remoteName: 'origin',
  remoteUrl: 'git@example.com:me/app.git',
  ...overrides,
})

const project = { id: 'p1', slug: 'app', name: 'App' } as Workspace

const repository = (verification = checked()): Repository => ({
  workspaceId: 'p1',
  source: { kind: 'local-path', path: '~/code/app' },
  verification,
  createdAt: '2026-11-03T10:00:00.000Z',
  updatedAt: '2026-11-03T10:00:00.000Z',
})

type Call = [string, { method: 'POST' | 'PUT', body?: Record<string, unknown> }]

function fakeApi(answer: (path: string) => unknown) {
  const calls: Call[] = []
  const api = async <T>(path: string, options: { method: 'POST' | 'PUT', body?: Record<string, unknown> }) => {
    calls.push([path, options])
    return answer(path) as T
  }
  return { api, calls }
}

const field = repositoryFormField(defineComponent({ name: 'path', render: () => null }), fakeApi(() => ({ repository: repository() })).api)

describe('the repository path field', () => {
  it('requires an absolute or home-relative path', () => {
    expect(field.schema.safeParse('').success).toBe(false)
    expect(field.schema.safeParse('   ').success).toBe(false)
    expect(field.schema.safeParse('code/app').success).toBe(false)
    expect(field.schema.safeParse('/home/me/app').success).toBe(true)
    expect(field.schema.safeParse('~').success).toBe(true)
    expect(field.schema.safeParse('~/code/app').success).toBe(true)
    expect(field.schema.parse('  /srv/app  ')).toBe('/srv/app')
  })

  it('sends nothing in the project body: the component fills the path from the stored repository', () => {
    expect(field.name).toBe('path')
    expect(field.initial(null)).toBe('')
    expect(field.initial(project)).toBe('')
    expect(field.request).toBeUndefined()
  })

  it('takes the daemon\'s path errors and the modal copy', () => {
    expect(field.errorCodes).toEqual(['invalid_path', 'path_not_found'])
    expect(field.description).toEqual({ create: 'Register a local codebase.', edit: 'Saving re-checks the path.' })
  })

  it('writes the path through the repository API after the save and summarises the check in the toast', async () => {
    const { api, calls } = fakeApi(() => ({ repository: repository() }))
    const saving = repositoryFormField(defineComponent({ name: 'path', render: () => null }), api)
    expect(await saving.afterSave?.(project, { value: '/srv/app', created: true }))
      .toEqual({ description: 'Path checked: issue tracker found, git remote origin.', color: 'success' })
    expect(calls).toEqual([['/workspaces/app/repository', { method: 'PUT', body: { source: { kind: 'local-path', path: '/srv/app' } } }]])
    expect(repositorySaveNote(repository(checked({ pathExists: false })))).toEqual({ description: 'Path not found.', color: 'warning' })
  })

  it('lets a refused path reach the form as its error', async () => {
    const api = async () => {
      throw new Error('path_not_found')
    }
    await expect(repositorySave(api, project, '/nowhere')).rejects.toThrow('path_not_found')
  })
})

describe('the repository path check', () => {
  it('summarises every outcome', () => {
    expect(repositoryVerificationSummary(checked({ pathExists: false }))).toBe('Path not found.')
    expect(repositoryVerificationSummary(checked({ hasBeads: false, isGitRepo: false }))).toBe('Path checked: no issue tracker, not a git repo.')
    expect(repositoryVerificationSummary(checked({ hasRemote: false }))).toBe('Path checked: issue tracker found, no git remote.')
  })

  it('re-checks a saved project through the repository verify endpoint', async () => {
    const { api, calls } = fakeApi(() => ({ repository: repository(checked({ hasBeads: false })) }))
    expect(await repositoryRecheck(api, project)).toEqual({ title: 'Checked App', description: 'Path checked: no issue tracker, git remote origin.' })
    expect(calls).toEqual([['/workspaces/app/repository/verify', { method: 'POST' }]])

    const action = repositoryRecheckAction(api)
    expect([action.id, action.label, action.icon]).toEqual(['repository', 'Re-check path', 'i-lucide-refresh-cw'])
    expect(await action.run(project)).toEqual({ title: 'Checked App', description: 'Path checked: no issue tracker, git remote origin.' })
  })

  it('lets a failed re-check reach the page', async () => {
    const api = async () => {
      throw new Error('down')
    }
    await expect(repositoryRecheck(api, project)).rejects.toThrow('down')
  })
})

describe('the repository facts', () => {
  const ids = (v: RepositoryVerification) => repositoryVerificationFacts(v).map(fact => [fact.id, fact.label, fact.color])

  it('shows only the missing path when the path is gone', () => {
    expect(ids(checked({ pathExists: false }))).toEqual([['path', 'Path not found', 'error']])
  })

  it('shows the issue tracker and the git state', () => {
    expect(ids(checked())).toEqual([['issues', 'Issue tracker', 'success'], ['git', 'Remote: origin', 'success']])
    expect(repositoryVerificationFacts(checked())[1]?.hint).toBe('git@example.com:me/app.git')
    expect(ids(checked({ hasBeads: false, hasRemote: false, remoteName: null, remoteUrl: null })))
      .toEqual([['issues', 'No issue tracker', 'warning'], ['git', 'No git remote', 'warning']])
    expect(ids(checked({ isGitRepo: false, hasRemote: false }))).toEqual([['issues', 'Issue tracker', 'success'], ['git', 'Not a git repo', 'neutral']])
  })
})
