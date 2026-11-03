import type { ApiErrorBody, OrganisationResponse, WorkspaceListResponse, WorkspaceResponse } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/platform'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { openTestDatabase } from '../testing'

let database: PlatformDatabase
let app: ReturnType<typeof createTestApp>
beforeEach(() => {
  database = openTestDatabase()
  app = createTestApp({ db: database.db, paths: dataPaths('/unused') })
})
afterEach(() => database.close())

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('workspace routes', () => {
  it('rejects malformed bodies', async () => {
    expect((await send('POST', '/workspaces', {})).status).toBe(400)
    expect((await send('POST', '/workspaces', { name: 7 })).status).toBe(400)
    const res = await app.request('/workspaces', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual<ApiErrorBody>({ error: { code: 'invalid_request', message: 'Request body must be valid JSON' } })
  })

  it('creates, updates, archives, lists and deletes workspaces without a repository', async () => {
    const created = await send('POST', '/workspaces', { name: 'Full' })
    expect(created.status).toBe(201)
    const { workspace } = await created.json() as WorkspaceResponse
    expect(workspace).toMatchObject({ slug: 'full', name: 'Full', archived: false })
    expect(workspace).not.toHaveProperty('source')
    expect(workspace).not.toHaveProperty('verification')

    const dup = await send('POST', '/workspaces', { name: 'Dup', slug: 'full' })
    expect(dup.status).toBe(409)

    const patched = await send('PATCH', '/workspaces/full', { name: 'Full Repo', color: '#123456' })
    expect((await patched.json() as WorkspaceResponse).workspace).toMatchObject({ slug: 'full', name: 'Full Repo', color: '#123456' })

    expect((await send('POST', '/workspaces/full/archive')).status).toBe(200)
    expect((await (await send('GET', '/workspaces')).json() as WorkspaceListResponse).workspaces).toEqual([])
    const all = await (await send('GET', '/workspaces?includeArchived=true')).json() as WorkspaceListResponse
    expect(all.workspaces.map(p => [p.slug, p.archived])).toEqual([['full', true]])

    expect((await send('DELETE', '/workspaces/full')).status).toBe(204)
    expect((await send('GET', '/workspaces/full')).status).toBe(404)
  })
})

describe('organisation routes', () => {
  it('ungroups workspaces when an organisation is deleted', async () => {
    const created = await send('POST', '/organisations', { name: 'New Orange' })
    expect(created.status).toBe(201)
    const { organisation } = await created.json() as OrganisationResponse
    expect(organisation.slug).toBe('new-orange')
    expect((await send('POST', '/organisations', { name: 'Other', slug: 'new-orange' })).status).toBe(409)

    await send('POST', '/workspaces', { name: 'Grouped', organisationId: organisation.id })

    expect((await send('DELETE', '/organisations/new-orange')).status).toBe(204)
    const { workspace } = await (await send('GET', '/workspaces/grouped')).json() as WorkspaceResponse
    expect(workspace.organisationId).toBeNull()
    expect((await send('GET', '/organisations/new-orange')).status).toBe(404)
  })
})
