import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, ApiErrorBody, Project, ProjectAssigneesResponse } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { setEnabledModules } from '../project-modules'
import { createProject, deleteProject } from '../projects/projects'
import { openTestDatabase } from '../testing'
import { addAssignee, listAssignees } from './service'

let database: PlatformDatabase
let root: string
beforeEach(() => {
  database = openTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-assignees-'))
  mkdirSync(join(root, '.beads'))
})
afterEach(() => {
  database.close()
  rmSync(root, { recursive: true, force: true })
})

async function project(name: string, enable = true): Promise<Project> {
  const created = await createProject(database.db, { name, source: { kind: 'local-path', path: root } })
  if (enable) setEnabledModules(database.db, created.id, ['issues'])
  return created
}

function app(roles = ['admin']) {
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createApp({ db: database.db, paths: dataPaths('/unused'), auth })
}
const post = (slug: string, body: unknown, roles?: string[]) =>
  app(roles).request(`/projects/${slug}/assignees`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

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
    deleteProject(database.db, 'alpha')
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
    expect(await (await app().request('/projects/alpha/assignees')).json() as ProjectAssigneesResponse).toEqual({ assignees: [{ name: 'Ana' }] })
    expect(await (await app().request('/projects/beta/assignees')).json() as ProjectAssigneesResponse).toEqual({ assignees: [] })
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
    const off = await app().request('/projects/off/assignees')
    expect(off.status).toBe(404)
    expect(((await off.json()) as ApiErrorBody).error.code).toBe('not_enabled')
    await project('alpha')
    expect((await app([]).request('/projects/alpha/assignees')).status).toBe(403)
  })
})
