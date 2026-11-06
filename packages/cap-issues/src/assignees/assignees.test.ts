import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, ApiErrorBody, Workspace } from '@candy-mountain/platform-sdk'
import type { ProjectAssigneesResponse } from '../wire'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type AuthStrategy, dataPaths, deleteWorkspace, type PlatformDatabase, setEnabledModules } from '@candy-mountain/platform-daemon'
import { issuesRoutes } from '../definition'
import { issuesTestProduct, openIssuesDatabase } from '../test-support'
import { addAssignee, listAssignees } from './service'
import { createWorkspaceWithRepository, repositoryPaths } from '@candy-mountain/cap-repository'

let database: PlatformDatabase
let root: string
beforeEach(() => {
  database = openIssuesDatabase()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-assignees-'))
  mkdirSync(join(root, '.beads'))
})
afterEach(() => {
  database.close()
  rmSync(root, { recursive: true, force: true })
})

async function project(name: string, enable = true): Promise<Workspace> {
  const created = await createWorkspaceWithRepository(database.db, { name, path: root })
  if (enable) setEnabledModules(database.db, created.id, ['issues'])
  return created
}

function app(roles = ['admin']) {
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createTestApp({ product: issuesTestProduct(), db: database.db, paths: dataPaths('/unused'), auth, runtime: issuesRoutes(repositoryPaths(database.db)) })
}
const post = (slug: string, body: unknown, roles?: string[]) =>
  app(roles).request(`/workspaces/${slug}/assignees`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('assignee service', () => {
  it('adds, trims, sorts and de-duplicates case-insensitively', async () => {
    const alpha = await project('alpha')
    expect(listAssignees(database.db, alpha.id)).toEqual([])
    addAssignee(database.db, alpha.id, '  zoe ')
    addAssignee(database.db, alpha.id, 'Ana')
    expect(addAssignee(database.db, alpha.id, 'ZOE')).toEqual({ name: 'zoe' })
    expect(listAssignees(database.db, alpha.id)).toEqual([{ name: 'Ana' }, { name: 'zoe' }])
  })

  it('keeps names per project and cascades on delete', async () => {
    const [alpha, beta] = [await project('alpha'), await project('beta')]
    addAssignee(database.db, alpha.id, 'Ana')
    addAssignee(database.db, beta.id, 'Ben')
    expect(listAssignees(database.db, alpha.id)).toEqual([{ name: 'Ana' }])
    deleteWorkspace(database.db, 'alpha')
    expect(listAssignees(database.db, alpha.id)).toEqual([])
    expect(listAssignees(database.db, beta.id)).toEqual([{ name: 'Ben' }])
  })
})

describe('assignee routes', () => {
  it('offers a posted name on the next list, per project', async () => {
    await project('alpha')
    await project('beta')
    const created = await post('alpha', { name: 'Ana' })
    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({ assignee: { name: 'Ana' } })
    expect(await (await app().request('/workspaces/alpha/assignees')).json() as ProjectAssigneesResponse).toEqual({ assignees: [{ name: 'Ana' }] })
    expect(await (await app().request('/workspaces/beta/assignees')).json() as ProjectAssigneesResponse).toEqual({ assignees: [] })
  })

  it('rejects bad bodies and unknown projects', async () => {
    await project('alpha')
    for (const body of ['{', {}, { name: 3 }, { name: '   ' }, { name: 'x'.repeat(101) }]) {
      const res = await post('alpha', body)
      expect(res.status).toBe(400)
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('invalid_request')
    }
    expect((await post('nope', { name: 'Ana' })).status).toBe(404)
  })

  it('is gated by the issues module and view', async () => {
    await project('off', false)
    const off = await app().request('/workspaces/off/assignees')
    expect(off.status).toBe(404)
    expect(((await off.json()) as ApiErrorBody).error.code).toBe('not_enabled')
    await project('alpha')
    expect((await app([]).request('/workspaces/alpha/assignees')).status).toBe(403)
  })
})
