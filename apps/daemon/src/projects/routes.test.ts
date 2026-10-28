import { join } from 'node:path'
import type { ApiErrorBody, OrganisationResponse, ProjectListResponse, ProjectResponse, VerifyPathResponse } from '@candy-mountain/shared'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { openTestDatabase } from '../testing'
import { createTempRepos } from './test-repos'

const repos = createTempRepos()
afterAll(() => repos.cleanup())

let database: PlatformDatabase
let app: ReturnType<typeof createApp>
beforeEach(() => {
  database = openTestDatabase()
  app = createApp({ db: database.db, paths: dataPaths('/unused') })
})
afterEach(() => database.close())

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('project routes', () => {
  it('fails to create a project at a missing path with a clear error', async () => {
    const missing = join(repos.root, 'missing')
    const res = await send('POST', '/projects', { name: 'Ghost', source: { kind: 'local-path', path: missing } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual<ApiErrorBody>({
      error: { code: 'path_not_found', message: `Project path does not exist or is not a directory: ${missing}` },
    })
  })

  it('rejects malformed bodies', async () => {
    expect((await send('POST', '/projects', { name: 'No source' })).status).toBe(400)
    expect((await send('POST', '/projects', { name: 'Bad kind', source: { kind: 'managed-clone', path: '/' } })).status).toBe(400)
    const res = await app.request('/projects', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
  })

  it('creates, updates, archives, lists and deletes projects', async () => {
    const path = repos.dir('full', { beads: true, git: true, remotes: { origin: 'git@github.com:jack/full.git' } })
    const created = await send('POST', '/projects', { name: 'Full', source: { kind: 'local-path', path } })
    expect(created.status).toBe(201)
    const { project } = await created.json() as ProjectResponse
    expect(project.verification).toMatchObject({ hasBeads: true, hasRemote: true, remoteUrl: 'git@github.com:jack/full.git' })

    const dup = await send('POST', '/projects', { name: 'Dup', slug: 'full', source: { kind: 'local-path', path } })
    expect(dup.status).toBe(409)

    const patched = await send('PATCH', '/projects/full', { name: 'Full Repo', color: '#123456' })
    expect((await patched.json() as ProjectResponse).project).toMatchObject({ slug: 'full', name: 'Full Repo', color: '#123456' })

    expect((await send('POST', '/projects/full/verify')).status).toBe(200)
    expect((await send('POST', '/projects/full/archive')).status).toBe(200)
    expect((await (await send('GET', '/projects')).json() as ProjectListResponse).projects).toEqual([])
    const all = await (await send('GET', '/projects?includeArchived=true')).json() as ProjectListResponse
    expect(all.projects.map(p => [p.slug, p.archived])).toEqual([['full', true]])

    expect((await send('DELETE', '/projects/full')).status).toBe(204)
    expect((await send('GET', '/projects/full')).status).toBe(404)
  })

  it('verifies a path without saving anything', async () => {
    const res = await send('POST', '/projects/verify-path', { path: repos.dir('preview', { beads: true }) })
    expect((await res.json() as VerifyPathResponse).verification).toMatchObject({ pathExists: true, hasBeads: true, isGitRepo: false })
  })
})

describe('organisation routes', () => {
  it('ungroups projects when an organisation is deleted', async () => {
    const created = await send('POST', '/organisations', { name: 'New Orange' })
    expect(created.status).toBe(201)
    const { organisation } = await created.json() as OrganisationResponse
    expect(organisation.slug).toBe('new-orange')
    expect((await send('POST', '/organisations', { name: 'Other', slug: 'new-orange' })).status).toBe(409)

    const path = repos.dir('grouped')
    await send('POST', '/projects', { name: 'Grouped', organisationId: organisation.id, source: { kind: 'local-path', path } })

    expect((await send('DELETE', '/organisations/new-orange')).status).toBe(204)
    const { project } = await (await send('GET', '/projects/grouped')).json() as ProjectResponse
    expect(project.organisationId).toBeNull()
    expect((await send('GET', '/organisations/new-orange')).status).toBe(404)
  })
})
