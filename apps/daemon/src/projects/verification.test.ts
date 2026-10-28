import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createTempRepos } from './test-repos'
import { normaliseProjectPath, verifyPath } from './verification'

describe('verifyPath', () => {
  const repos = createTempRepos()
  afterAll(() => repos.cleanup())

  it('reports a missing path', async () => {
    expect(await verifyPath(join(repos.root, 'nope'))).toMatchObject({
      pathExists: false, hasBeads: false, isGitRepo: false, hasRemote: false, remoteUrl: null,
    })
  })

  it('treats a file as a missing directory', async () => {
    const file = join(repos.root, 'file.txt')
    writeFileSync(file, '')
    expect((await verifyPath(file)).pathExists).toBe(false)
  })

  it('reports a plain directory with no beads and no git', async () => {
    expect(await verifyPath(repos.dir('plain'))).toMatchObject({
      pathExists: true, hasBeads: false, isGitRepo: false, hasRemote: false, remoteName: null, remoteUrl: null,
    })
  })

  it('reports beads and the origin remote of a git repository', async () => {
    const path = repos.dir('full', {
      beads: true,
      git: true,
      remotes: { upstream: 'git@github.com:other/full.git', origin: 'git@github.com:jack/full.git' },
    })
    const result = await verifyPath(path)
    expect(result).toMatchObject({
      pathExists: true, hasBeads: true, isGitRepo: true, hasRemote: true, remoteName: 'origin', remoteUrl: 'git@github.com:jack/full.git',
    })
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false)
  })

  it('reports a git repository without a remote', async () => {
    expect(await verifyPath(repos.dir('local-only', { git: true }))).toMatchObject({
      isGitRepo: true, hasRemote: false, remoteName: null, remoteUrl: null,
    })
  })

  it('falls back to the first remote when there is no origin', async () => {
    const path = repos.dir('no-origin', { git: true, remotes: { github: 'https://github.com/jack/x.git' } })
    expect(await verifyPath(path)).toMatchObject({ hasRemote: true, remoteName: 'github', remoteUrl: 'https://github.com/jack/x.git' })
  })

  it('strips credentials from http remote URLs', async () => {
    const path = repos.dir('token', { git: true, remotes: { origin: 'https://x-access-token:secret@github.com/jack/t.git' } })
    expect((await verifyPath(path)).remoteUrl).toBe('https://github.com/jack/t.git')
  })
})

describe('normaliseProjectPath', () => {
  it('expands ~ and removes trailing slashes', () => {
    expect(normaliseProjectPath('~/work/x/')).toBe(join(homedir(), 'work', 'x'))
  })

  it('rejects relative paths', () => {
    expect(() => normaliseProjectPath('work/x')).toThrow(/must be absolute/)
  })
})
