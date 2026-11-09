import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiErrorBody, Workspace } from '@crab-shack/platform-sdk'
import type { ProjectAssigneesResponse } from '../wire'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteWorkspace } from '@crab-shack/platform-daemon'
import type { TestKit } from '@crab-shack/platform-daemon/testing'
import { issuesKit, workspaceAt } from '../test-support'
import { addAssignee, listAssignees } from './service'

let kit: TestKit
let root: string
beforeEach(() => {
  kit = issuesKit()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-assignees-'))
  mkdirSync(join(root, '.beads'))
})
afterEach(async () => {
  await kit.close()
  rmSync(root, { recursive: true, force: true })
})

const project = (name: string, enable = true): Promise<Workspace> => workspaceAt(kit, root, { name, slug: name, modules: enable ? ['issues'] : [] })

const post = (slug: string, body: unknown, as = kit.admin) =>
  as.request(`/workspaces/${slug}/assignees`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('assignee service', () => {
  it('adds, trims, sorts and de-duplicates case-insensitively', async () => {
    const alpha = await project('alpha')
    expect(listAssignees(kit.db, alpha.id)).toEqual([])
    addAssignee(kit.db, alpha.id, '  zoe ')
    addAssignee(kit.db, alpha.id, 'Ana')
    expect(addAssignee(kit.db, alpha.id, 'ZOE')).toEqual({ name: 'zoe' })
    expect(listAssignees(kit.db, alpha.id)).toEqual([{ name: 'Ana' }, { name: 'zoe' }])
  })

  it('keeps names per project and cascades on delete', async () => {
    const [alpha, beta] = [await project('alpha'), await project('beta')]
    addAssignee(kit.db, alpha.id, 'Ana')
    addAssignee(kit.db, beta.id, 'Ben')
    expect(listAssignees(kit.db, alpha.id)).toEqual([{ name: 'Ana' }])
    deleteWorkspace(kit.db, 'alpha')
    expect(listAssignees(kit.db, alpha.id)).toEqual([])
    expect(listAssignees(kit.db, beta.id)).toEqual([{ name: 'Ben' }])
  })
})

describe('assignee routes', () => {
  it('offers a posted name on the next list, per project', async () => {
    await project('alpha')
    await project('beta')
    const created = await post('alpha', { name: 'Ana' })
    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({ assignee: { name: 'Ana' } })
    expect(await (await kit.admin.request('/workspaces/alpha/assignees')).json() as ProjectAssigneesResponse).toEqual({ assignees: [{ name: 'Ana' }] })
    expect(await (await kit.admin.request('/workspaces/beta/assignees')).json() as ProjectAssigneesResponse).toEqual({ assignees: [] })
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
    const off = await kit.admin.request('/workspaces/off/assignees')
    expect(off.status).toBe(404)
    expect(((await off.json()) as ApiErrorBody).error.code).toBe('not_enabled')
    await project('alpha')
    expect((await kit.actor().request('/workspaces/alpha/assignees')).status).toBe(403)
  })
})
