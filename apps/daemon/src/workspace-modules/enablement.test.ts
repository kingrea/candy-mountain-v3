import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, ApiErrorBody, Workspace, WorkspaceModulesResponse } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/platform'
import type { AuthStrategy } from '../auth'
import { CANDY_MOUNTAIN } from '../candy-mountain'
import { productCapabilityRegistry } from '../product'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { createModuleRegistry, MODULES } from '../modules'
import { deleteWorkspace } from '../workspaces/workspaces'
import { openTestDatabase } from '../testing'
import { listEnabledModules, setEnabledModules } from './enablement'
import { createWorkspaceWithRepository } from '../repository/test-support'

let database: PlatformDatabase
let root: string
beforeEach(() => {
  database = openTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-modules-'))
})
afterEach(() => {
  database.close()
  rmSync(root, { recursive: true, force: true })
})

function workspace(name: string): Promise<Workspace> {
  return createWorkspaceWithRepository(database.db, { name, path: root })
}

function app(roles = ['admin']) {
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createTestApp({ db: database.db, paths: dataPaths('/unused'), auth })
}

const put = (slug: string, body: unknown, roles?: string[]) =>
  app(roles).request(`/workspaces/${slug}/modules`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('module enablement service', () => {
  it('starts with nothing enabled', async () => {
    const alpha = await workspace('alpha')
    expect(listEnabledModules(database.db, alpha.id)).toEqual([])
  })

  it('replaces the set, enabling and disabling', async () => {
    const alpha = await workspace('alpha')
    expect(setEnabledModules(database.db, alpha.id, ['operations', 'issues'])).toEqual(['issues', 'operations'])
    expect(setEnabledModules(database.db, alpha.id, ['operations', 'agent-hub', 'agent-hub'])).toEqual(['agent-hub', 'operations'])
    expect(setEnabledModules(database.db, alpha.id, [])).toEqual([])
    expect(listEnabledModules(database.db, alpha.id)).toEqual([])
  })

  it('orders by the module registry and drops modules it no longer registers', async () => {
    const alpha = await workspace('alpha')
    const modules = createModuleRegistry(MODULES, productCapabilityRegistry(CANDY_MOUNTAIN))
    expect(setEnabledModules(database.db, alpha.id, ['operations', 'retired', 'agent-hub'], modules)).toEqual(['agent-hub', 'operations'])
    expect(listEnabledModules(database.db, alpha.id)).toEqual(['agent-hub', 'operations', 'retired'])
    setEnabledModules(database.db, alpha.id, ['operations', 'issues'])
    expect(listEnabledModules(database.db, alpha.id, modules)).toEqual(['issues', 'operations'])
  })

  it('keeps workspaces independent and cascades on workspace delete', async () => {
    const [alpha, beta] = [await workspace('alpha'), await workspace('beta')]
    setEnabledModules(database.db, alpha.id, ['issues'])
    setEnabledModules(database.db, beta.id, ['operations'])
    expect(listEnabledModules(database.db, alpha.id)).toEqual(['issues'])
    deleteWorkspace(database.db, 'alpha')
    expect(listEnabledModules(database.db, alpha.id)).toEqual([])
    expect(listEnabledModules(database.db, beta.id)).toEqual(['operations'])
  })
})

describe('module enablement routes', () => {
  it('a new workspace reports no modules', async () => {
    await workspace('alpha')
    const res = await app().request('/workspaces/alpha/modules')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual<WorkspaceModulesResponse>({ modules: [] })
  })

  it('persists enabling and disabling', async () => {
    await workspace('alpha')
    expect(await (await put('alpha', { modules: ['issues', 'agent-hub'] })).json()).toEqual({ modules: ['issues', 'agent-hub'] })
    expect(await (await app().request('/workspaces/alpha/modules')).json()).toEqual({ modules: ['issues', 'agent-hub'] })
    await put('alpha', { modules: ['agent-hub'] })
    expect(await (await app().request('/workspaces/alpha/modules')).json()).toEqual({ modules: ['agent-hub'] })
  })

  it('rejects an unknown module id and leaves the set unchanged', async () => {
    await workspace('alpha')
    await put('alpha', { modules: ['issues'] })
    const res = await put('alpha', { modules: ['issues', 'bots'] })
    expect(res.status).toBe(422)
    expect((await res.json() as ApiErrorBody).error.code).toBe('module_not_found')
    expect(await (await app().request('/workspaces/alpha/modules')).json()).toEqual({ modules: ['issues'] })
  })

  it('rejects malformed bodies and unknown workspaces', async () => {
    await workspace('alpha')
    for (const body of ['{', { modules: 'issues' }, { modules: [1] }, {}]) {
      const res = await put('alpha', body)
      expect([res.status, (await res.json() as ApiErrorBody).error.code]).toEqual([400, 'invalid_request'])
    }
    expect((await put('ghost', { modules: [] })).status).toBe(404)
    expect((await app().request('/workspaces/ghost/modules')).status).toBe(404)
  })

  it('is admin only', async () => {
    await workspace('alpha')
    expect((await app(['developer']).request('/workspaces/alpha/modules')).status).toBe(403)
    expect((await put('alpha', { modules: ['issues'] }, ['developer'])).status).toBe(403)
  })
})
