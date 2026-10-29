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
  it('is the project home with no module enabled', async () => {
    h = instanceHarness([])
    await h.createProject('alpha')

    const result = await registry()
    expect(result.groups.map(g => g.id)).toEqual(['overview', 'system'])
    expect(result.groups[0]).toMatchObject({ kind: 'capability', label: 'Overview', entries: [{ id: 'overview', label: 'Overview', icon: 'i-lucide-house', to: '/p/alpha' }] })
    expect(result.capabilities.find(c => c.id === 'overview')).toMatchObject({ rung: 'read', ready: true, reasons: [], modules: [], views: ['overview'] })
    expect(result.views.find(v => v.id === 'overview')).toMatchObject({ path: '', to: '/p/alpha', ready: true })
  })

  it('leads the sidebar ahead of the enabled modules', async () => {
    h = instanceHarness([])
    const project = await h.createProject('alpha')
    setEnabledModules(h.database.db, project.id, ['issues'])

    expect((await registry()).groups.map(g => g.id)).toEqual(['overview', 'issues', 'system'])
  })

  it('gives a role with no grants at all the read rung', async () => {
    h = instanceHarness([])
    await h.createProject('alpha')
    addRole(h.database.db, 'developer')

    const result = await registry(['developer'])
    expect(result.capabilities.find(c => c.id === 'overview')).toMatchObject({ rung: 'read', ready: true })
    expect(result.groups[0]!.entries.map(e => e.to)).toEqual(['/p/alpha'])
  })
})
