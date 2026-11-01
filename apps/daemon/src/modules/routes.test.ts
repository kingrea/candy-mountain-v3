import { MODULES_PATH, type Actor, type ModuleListResponse } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/platform'
import type { AuthStrategy } from '../auth'
import { createCapabilityRegistry } from '../capabilities'
import { fixtureCapability } from '../capabilities/fixtures'
import type { PlatformDatabase } from '../db'
import { openTestDatabase } from '../testing'
import { createModuleRegistry } from './registry'

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase()
})
afterEach(() => database.close())

const as = (roles: string[]): AuthStrategy => ({
  name: 'development',
  resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }),
})

function app(roles: string[]) {
  const issues = { ...fixtureCapability('issues', ['repository']), requiresProjectFacts: ['hasBeads'] as const }
  const bots = { ...fixtureCapability('bots'), requiresAnyPlugins: [['claude-code', 'codex']] as const }
  const capabilities = createCapabilityRegistry([issues, bots])
  const modules = createModuleRegistry([
    { id: 'issues', label: 'Issues', description: 'Issues.', icon: 'i-lucide-list-todo', capabilities: [{ capabilityId: 'issues', defaultRung: 'read' }] },
    { id: 'agent-hub', label: 'Agent Hub', description: 'Agents.', icon: 'i-lucide-bot', capabilities: [{ capabilityId: 'bots', defaultRung: 'full' }] },
    { id: 'operations', label: 'Operations', description: 'Ops.', icon: 'i-lucide-activity', capabilities: [] },
  ], capabilities)
  return createTestApp({ db: database.db, paths: {} as never, capabilities, modules, auth: as(roles) })
}

describe('module routes', () => {
  it('lists modules with each member\'s requirements, for any signed-in actor', async () => {
    for (const roles of [['admin'], ['developer']]) {
      const res = await app(roles).request(MODULES_PATH)
      expect(res.status).toBe(200)
      const { modules } = await res.json() as ModuleListResponse
      expect(modules.map(m => m.id)).toEqual(['issues', 'agent-hub', 'operations'])
      expect(modules[0]!.capabilities).toEqual([{
        capabilityId: 'issues',
        defaultRung: 'read',
        label: 'Fixture issues',
        description: 'Test fixture for issues.',
        requiresPlugins: ['repository'],
        requiresAnyPlugins: [],
        requiresProjectFacts: ['hasBeads'],
      }])
      expect(modules[1]!.capabilities[0]).toMatchObject({ requiresPlugins: [], requiresAnyPlugins: [['claude-code', 'codex']], requiresProjectFacts: [] })
      expect(modules[2]!.capabilities).toEqual([])
    }
  })
})
