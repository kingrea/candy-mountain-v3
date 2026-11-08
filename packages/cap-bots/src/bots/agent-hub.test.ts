import { randomUUID } from 'node:crypto'
import { workspaceRegistryPath, type Workspace, type RegistryResponse } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { bots } from '../schema'
import { addRole, createPluginInstance, fixturePluginType, type InstanceHarness, setEnabledModules, TEST_PRODUCT_CONFIG, testPluginInstance } from '@candy-mountain/platform-daemon'
import { instanceHarness } from '../test-support'

let h: InstanceHarness
afterEach(() => h.close())

async function setup(healthy: readonly string[]): Promise<Workspace> {
  h = instanceHarness([fixturePluginType('repository'), fixturePluginType('claude-code'), fixturePluginType('codex')])
  const workspace = await h.createWorkspace('alpha')
  setEnabledModules(h.database.db, workspace.id, ['agent-hub'])
  for (const type of healthy) {
    const instance = createPluginInstance(h.deps, { type, scope: 'workspace', workspaceId: workspace.id, config: { account: 'jack' }, secrets: { token: 't' } })
    await testPluginInstance(h.deps, instance.id)
  }
  return workspace
}

/** Scoped to Bots and Team; the chat capabilities in the same module have their own tests. */
async function registry(roles?: string[]): Promise<RegistryResponse> {
  const res = await h.app(roles).request(workspaceRegistryPath('alpha'))
  expect(res.status).toBe(200)
  const body = await res.json() as RegistryResponse
  const ours = (id: string) => id === 'bots' || id === 'team'
  return {
    ...body,
    capabilities: body.capabilities.filter(c => ours(c.id)),
    degraded: body.degraded.map(d => ({ ...d, reasons: d.reasons.filter(r => ours(r.capabilityId)) })).filter(d => d.reasons.length),
  }
}

function addBot(workspaceId: string) {
  const now = new Date().toISOString()
  h.database.db.insert(bots).values({ id: randomUUID(), projectId: workspaceId, name: 'Candy', family: 'claude-code', writeScope: 'read-only', answersIn: { anywhere: true }, createdAt: now, updatedAt: now }).run()
}

describe('Agent Hub bots and team', () => {
  it('shows Bots once Repository and Claude Code are healthy, and holds Team back until a bot exists', async () => {
    const workspace = await setup(['repository', 'claude-code'])

    const before = await registry()
    expect(before.groups.find(g => g.id === 'agent-hub')).toMatchObject({ id: 'agent-hub', label: 'Agent Hub', entries: [{ id: 'bots', to: '/w/alpha/bots' }, { id: 'team', to: '/w/alpha/team' }] })
    expect(before.capabilities).toEqual([
      expect.objectContaining({ id: 'bots', rung: 'manage', ready: true, reasons: [], modules: ['agent-hub'] }),
      expect.objectContaining({ id: 'team', rung: 'manage', ready: false, reasons: [{ kind: 'workspace-fact', fact: 'hasBots', message: 'The workspace has no bots yet; add one on the Bots page.' }] }),
    ])
    expect(before.views.map(v => [v.id, v.path, v.ready])).toEqual([['overview', '', true], ['bots', 'bots', true], ['team', 'team', false]])

    addBot(workspace.id)
    const after = await registry()
    expect(after.capabilities.map(c => [c.id, c.ready])).toEqual([['bots', true], ['team', true]])
    expect(after.degraded).toEqual([])
  })

  it('is satisfied by Codex alone', async () => {
    await setup(['repository', 'codex'])
    expect((await registry()).capabilities[0]).toMatchObject({ id: 'bots', ready: true })
  })

  it('names both agent plugins when neither is healthy', async () => {
    await setup(['repository'])
    const result = await registry()
    expect(result.capabilities[0]!.reasons).toEqual([{ kind: 'plugin-any', plugins: ['claude-code', 'codex'], message: 'Needs one of: Fixture claude-code, Fixture codex; none is configured and healthy.' }])
    expect(result.degraded[0]).toMatchObject({ id: 'agent-hub', reasons: [{ capabilityId: 'bots', kind: 'plugin-any' }, { capabilityId: 'team', fact: 'hasBots' }] })
  })

  it('gives a role granted the module the manage rung by default, showing it only the ready Bots view', async () => {
    await setup(['repository', 'claude-code'])
    addRole(h.database.db, 'developer')
    const res = await h.app().request('/grants', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'developer', target: { kind: 'module', id: 'agent-hub' }, rungs: {} }) })
    expect(res.status).toBe(200)

    const result = await registry(['developer'])
    expect(result.capabilities.map(c => [c.id, c.rung, c.ready])).toEqual([['bots', 'manage', true], ['team', 'manage', false]])
    expect(result.groups.map(g => [g.id, g.entries.map(e => e.id)])).toEqual([['overview', ['overview']], ['agent-hub', ['bots']], ['system', [TEST_PRODUCT_CONFIG.scope.listPath, 'activity', 'settings']]])
    expect(result.views.find(v => v.id === 'team')).toMatchObject({ ready: false })
  })
})
