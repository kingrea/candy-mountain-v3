import { join } from 'node:path'
import type { ApiErrorBody } from '@crab-shack/platform-sdk'
import { REPOSITORY_CHECK_PATH, repositoryPath, repositoryVerifyPath, type RepositoryCheckResponse, type RepositoryResponse } from './wire'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testKit, type TestKit } from '@crab-shack/platform-daemon/testing'
import { repositoryDefinition } from './definition'
import { createTempRepos } from './test-repos'

const repos = createTempRepos()
afterAll(() => repos.cleanup())

let kit: TestKit
beforeEach(() => {
  kit = testKit({ capabilities: [repositoryDefinition()] })
  kit.workspace({ name: 'Alpha', slug: 'alpha' })
})
afterEach(() => kit.close())

function send(method: string, path: string, body?: unknown) {
  return kit.admin.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('repository routes', () => {
  it('reads, sets and re-checks a workspace repository', async () => {
    expect((await send('GET', repositoryPath('alpha'))).status).toBe(404)
    expect(await (await send('GET', repositoryPath('alpha'))).json()).toMatchObject({ error: { code: 'not_found' } })
    expect((await send('GET', repositoryPath('nope'))).status).toBe(404)

    const path = repos.dir('full', { beads: true, git: true, remotes: { origin: 'git@github.com:jack/full.git' } })
    const set = await send('PUT', repositoryPath('alpha'), { source: { kind: 'local-path', path } })
    expect(set.status).toBe(200)
    const { repository } = await set.json() as RepositoryResponse
    expect(repository).toMatchObject({ source: { kind: 'local-path', path }, verification: { hasBeads: true, hasRemote: true, remoteUrl: 'git@github.com:jack/full.git' } })
    expect((await (await send('GET', repositoryPath('alpha'))).json() as RepositoryResponse).repository).toEqual(repository)

    const verified = await send('POST', repositoryVerifyPath('alpha'))
    expect(verified.status).toBe(200)
    expect((await verified.json() as RepositoryResponse).repository).toMatchObject({ source: { path }, verification: { hasBeads: true } })
    expect((await send('POST', repositoryVerifyPath('nope'))).status).toBe(404)
  })

  it('refuses a missing path with a clear error and rejects malformed bodies', async () => {
    const missing = join(repos.root, 'missing')
    const res = await send('PUT', repositoryPath('alpha'), { source: { kind: 'local-path', path: missing } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual<ApiErrorBody>({
      error: { code: 'path_not_found', message: `Repository path does not exist or is not a directory: ${missing}` },
    })
    expect((await send('PUT', repositoryPath('alpha'), { source: { kind: 'local-path', path: 'code/app' } })).status).toBe(422)

    expect((await send('PUT', repositoryPath('alpha'), {})).status).toBe(400)
    expect((await send('PUT', repositoryPath('alpha'), { source: { kind: 'managed-clone', path: '/' } })).status).toBe(400)
    expect((await send('POST', REPOSITORY_CHECK_PATH, {})).status).toBe(400)
    const raw = await kit.admin.request(repositoryPath('alpha'), { method: 'PUT', body: 'not json', headers: { 'content-type': 'application/json' } })
    expect(raw.status).toBe(400)
  })

  it('checks a path without saving anything', async () => {
    const res = await send('POST', REPOSITORY_CHECK_PATH, { path: repos.dir('preview', { beads: true }) })
    expect(res.status).toBe(200)
    expect((await res.json() as RepositoryCheckResponse).verification).toMatchObject({ pathExists: true, hasBeads: true, isGitRepo: false })
    expect((await send('GET', repositoryPath('alpha'))).status).toBe(404)
  })
})
