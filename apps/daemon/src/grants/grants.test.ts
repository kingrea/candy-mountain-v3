import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlatformDatabase } from '../db'
import { roleGrants, roles } from '../db/schema'
import { startPlatform } from '../platform'
import { createTempDataDir, openTestDatabase, type TempDataDir } from '../testing'
import type { AccessDeps } from './access'
import { GrantError } from './errors'
import { listGrants, setGrant } from './grants'
import { resolveActorRungs } from './resolve'
import { seedAdminGrants } from './seed'
import { addRole, TEST_CAPABILITIES, TEST_MODULES, testAccess } from './test-access'

function expectGrantError(fn: () => unknown, code: string, message: string) {
  let caught: unknown
  try {
    fn()
  }
  catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(GrantError)
  expect(caught).toMatchObject({ code, message })
}

describe('setGrant', () => {
  let database: PlatformDatabase
  let deps: AccessDeps
  beforeEach(() => {
    database = openTestDatabase()
    deps = testAccess(database.db)
    addRole(database.db, 'developer')
  })
  afterEach(() => database.close())

  it('stores a module grant with every member explicit', () => {
    const grant = setGrant(deps, { role: 'developer', target: { kind: 'module', id: 'operations' }, rungs: { deployments: 'full' } })
    expect(grant).toMatchObject({ role: 'developer', target: { kind: 'module', id: 'operations' }, rungs: { uptime: 'read', deployments: 'full' } })
    expect(listGrants(database.db)).toEqual([grant])
  })

  it('replaces the grant on the same target', () => {
    const first = setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } })
    const second = setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'full' } })
    expect(second.rungs).toEqual({ team: 'full' })
    expect(second.createdAt).toBe(first.createdAt)
    expect(listGrants(database.db)).toHaveLength(1)
  })

  it('filters by role', () => {
    addRole(database.db, 'support')
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } })
    setGrant(deps, { role: 'support', target: { kind: 'capability', id: 'team' }, rungs: { team: 'full' } })
    expect(listGrants(database.db, ['support']).map(g => g.rungs)).toEqual([{ team: 'full' }])
    expect(listGrants(database.db, [])).toEqual([])
  })

  it('rejects unknown roles, targets and rungs', () => {
    expectGrantError(() => setGrant(deps, { role: 'ghost', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } }), 'role_not_found', "Role 'ghost' does not exist")
    expectGrantError(() => setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'bots' }, rungs: { bots: 'read' } }), 'target_not_found', "Capability 'bots' is not registered")
    expectGrantError(() => setGrant(deps, { role: 'developer', target: { kind: 'module', id: 'nope' as never }, rungs: {} }), 'target_not_found', "Module 'nope' is not registered")
    expectGrantError(() => setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'owner' } }), 'invalid_rung', "'owner' is not a rung of capability 'team' (none, read, full)")
    expectGrantError(() => setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { uptime: 'read' } }), 'invalid_rung', "A grant on capability 'team' sets a rung for 'team' only")
    expectGrantError(() => setGrant(deps, { role: 'developer', target: { kind: 'module', id: 'operations' }, rungs: { team: 'read' } }), 'invalid_rung', "Capability 'team' is not in module 'operations'")
    expect(listGrants(database.db)).toEqual([])
  })

  it('cascades with the role', () => {
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } })
    database.db.delete(roles).run()
    expect(database.db.select().from(roleGrants).all()).toEqual([])
  })
})

describe('seedAdminGrants', () => {
  it('grants the admin every module at the top rung once and keeps later edits', () => {
    const database = openTestDatabase()
    const deps = testAccess(database.db)
    try {
      seedAdminGrants(deps)
      expect(listGrants(database.db).map(g => [g.role, g.target.id, g.rungs])).toEqual([
        ['admin', 'agent-hub', {}],
        ['admin', 'issues', { issues: 'full', uptime: 'full' }],
        ['admin', 'operations', { uptime: 'full', deployments: 'full' }],
      ])
      setGrant(deps, { role: 'admin', target: { kind: 'module', id: 'issues' }, rungs: { issues: 'read' } })
      seedAdminGrants(deps)
      expect(listGrants(database.db)).toHaveLength(3)
      expect(listGrants(database.db).find(g => g.target.id === 'issues')!.rungs).toEqual({ issues: 'read', uptime: 'full' })
    }
    finally {
      database.close()
    }
  })
})

describe('grants across restarts', () => {
  let temp: TempDataDir
  afterEach(() => temp.cleanup())

  it('keeps grants and resolved rungs after the platform restarts', () => {
    temp = createTempDataDir()
    const options = { capabilities: TEST_CAPABILITIES, modules: TEST_MODULES }
    const first = startPlatform(temp.root, options)
    addRole(first.db, 'developer')
    expect(listGrants(first.db).map(g => g.target.id)).toEqual(['agent-hub', 'issues', 'operations'])
    const grant = setGrant(first, { role: 'developer', target: { kind: 'module', id: 'operations' }, rungs: { deployments: 'full' } })
    first.close()

    const second = startPlatform(temp.root, options)
    try {
      expect(second.appliedMigrations).toBe(0)
      expect(listGrants(second.db, ['developer'])).toEqual([grant])
      expect(listGrants(second.db, ['admin'])).toHaveLength(3)
      expect(resolveActorRungs(second, { roles: ['developer'] })).toEqual({ issues: 'none', uptime: 'read', deployments: 'full', team: 'none' })
    }
    finally {
      second.close()
    }
  })
})
