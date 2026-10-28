import { projectRegistryPath, type RegistryResponse } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { addRole } from '../grants/test-access'
import { instanceHarness, type InstanceHarness } from '../plugins/instances/test-support'
import { setEnabledModules } from '../project-modules/enablement'

let h: InstanceHarness
afterEach(() => h.close())

async function registry(roles?: string[]): Promise<RegistryResponse> {
  const res = await h.app(roles).request(projectRegistryPath('alpha'))
  expect(res.status).toBe(200)
  return res.json() as Promise<RegistryResponse>
}

describe('Overview', () => {
  it('appears as the project home once the Issues module is enabled', async () => {
    h = instanceHarness([])
    const project = await h.createProject('alpha')

    const before = await registry()
    expect(before.views.find(v => v.id === 'overview')).toBeUndefined()
    expect(before.groups.map(g => g.id)).toEqual(['system'])

    setEnabledModules(h.database.db, project.id, ['issues'])
    const after = await registry()
    expect(after.groups[0]).toMatchObject({ id: 'issues', label: 'Issues' })
    expect(after.groups[0]!.entries[0]).toEqual({ id: 'overview', label: 'Overview', icon: 'i-lucide-house', to: '/p/alpha' })
    expect(after.capabilities.find(c => c.id === 'overview')).toMatchObject({ rung: 'read', ready: true, reasons: [], modules: ['issues'], views: ['overview'] })
    expect(after.views.find(v => v.id === 'overview')).toMatchObject({ path: '', to: '/p/alpha', ready: true })
  })

  it('gives a role granted the Issues module the read rung by default', async () => {
    h = instanceHarness([])
    const project = await h.createProject('alpha')
    setEnabledModules(h.database.db, project.id, ['issues'])
    addRole(h.database.db, 'developer')
    const res = await h.app().request('/grants', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'developer', target: { kind: 'module', id: 'issues' }, rungs: {} }) })
    expect(res.status).toBe(200)

    const result = await registry(['developer'])
    expect(result.capabilities.find(c => c.id === 'overview')).toMatchObject({ rung: 'read', ready: true })
    expect(result.groups[0]!.entries.map(e => e.to)).toContain('/p/alpha')
  })
})
