import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspace, deleteWorkspace, openTestDatabase, type PlatformDatabase } from '@candy-mountain/platform-daemon'
import { repositoryDefinition } from './definition'
import { RepositoryError } from './errors'
import { checkRepositoryPath, findRepository, getRepository, repositoryPaths, reverifyRepository, setRepository } from './service'
import { createTempRepos } from './test-repos'

const repos = createTempRepos()
afterAll(() => repos.cleanup())

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase({ definitions: [repositoryDefinition()] })
})
afterEach(() => database.close())

const localPath = (path: string) => ({ kind: 'local-path' as const, path })

async function expectRepositoryError(promise: Promise<unknown> | (() => unknown), code: string) {
  const run = typeof promise === 'function' ? Promise.resolve().then(promise) : promise
  await expect(run).rejects.toSatisfy(error => error instanceof RepositoryError && error.code === code)
}

describe('a workspace repository', () => {
  it('rejects a path that does not exist or is relative, saving nothing', async () => {
    const workspace = createWorkspace(database.db, { name: 'Ghost' })
    const missing = join(repos.root, 'missing')
    await expect(setRepository(database.db, workspace.id, localPath(missing))).rejects.toThrow(
      `Repository path does not exist or is not a directory: ${missing}`,
    )
    await expectRepositoryError(setRepository(database.db, workspace.id, localPath('code/app')), 'invalid_path')
    expect(findRepository(database.db, workspace.id)).toBeNull()
    await expectRepositoryError(() => getRepository(database.db, workspace.id), 'not_found')
  })

  it('records beads and remote facts when set, normalising the path', async () => {
    const workspace = createWorkspace(database.db, { name: 'Candy Mountain' })
    const path = repos.dir('candy', { beads: true, git: true, remotes: { origin: 'git@github.com:jack/candy.git' } })
    const repository = await setRepository(database.db, workspace.id, localPath(`${path}/`))
    expect(repository).toMatchObject({
      workspaceId: workspace.id,
      source: { kind: 'local-path', path },
      verification: { pathExists: true, hasBeads: true, isGitRepo: true, hasRemote: true, remoteUrl: 'git@github.com:jack/candy.git' },
    })
    expect(getRepository(database.db, workspace.id)).toEqual(repository)
  })

  it('replaces the repository on a second set, keeping one row per workspace', async () => {
    const workspace = createWorkspace(database.db, { name: 'Moving' })
    const first = await setRepository(database.db, workspace.id, localPath(repos.dir('first')))
    const moved = repos.dir('second', { beads: true })
    const second = await setRepository(database.db, workspace.id, localPath(moved))
    expect(second).toMatchObject({ source: { path: moved }, verification: { hasBeads: true }, createdAt: first.createdAt })
    expect(getRepository(database.db, workspace.id)).toEqual(second)
  })

  it('re-runs the check on demand without failing when the path has gone', async () => {
    const workspace = createWorkspace(database.db, { name: 'Reverify' })
    const path = repos.dir('reverify')
    await setRepository(database.db, workspace.id, localPath(path))
    repos.dir('reverify', { beads: true })
    expect((await reverifyRepository(database.db, workspace.id)).verification.hasBeads).toBe(true)

    rmSync(path, { recursive: true })
    expect((await reverifyRepository(database.db, workspace.id)).verification).toMatchObject({ pathExists: false, hasBeads: false })
    expect(getRepository(database.db, workspace.id).verification.pathExists).toBe(false)
    await expectRepositoryError(reverifyRepository(database.db, 'nope'), 'not_found')
  })

  it('checks a path without saving anything', async () => {
    expect(await checkRepositoryPath(repos.dir('preview', { beads: true }))).toMatchObject({ pathExists: true, hasBeads: true, isGitRepo: false })
    expect(await checkRepositoryPath(join(repos.root, 'nope'))).toMatchObject({ pathExists: false })
    await expectRepositoryError(checkRepositoryPath('relative'), 'invalid_path')
  })

  it('goes with its workspace', async () => {
    const workspace = createWorkspace(database.db, { name: 'Doomed' })
    await setRepository(database.db, workspace.id, localPath(repos.dir('doomed')))
    deleteWorkspace(database.db, 'doomed')
    expect(findRepository(database.db, workspace.id)).toBeNull()
  })
})

describe('the repository path service', () => {
  it('answers a workspace checkout and refuses one without a repository', async () => {
    const workspace = createWorkspace(database.db, { name: 'Alpha' })
    const paths = repositoryPaths(database.db)
    expect(paths.find(workspace.id)).toBeNull()
    expect(() => paths.get(workspace.id)).toThrow(RepositoryError)

    const path = repos.dir('alpha')
    await setRepository(database.db, workspace.id, localPath(path))
    expect(paths.find(workspace.id)).toBe(path)
    expect(paths.get(workspace.id)).toBe(path)
  })
})
