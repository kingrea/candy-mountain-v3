import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformDatabase } from '../db'
import { roleGrants } from '../db/schema'
import { openTestDatabase } from '../testing'
import type { AccessDeps } from './access'
import { setGrant } from './grants'
import { resolveActorRungs, resolveRoleRungs, rungOf } from './resolve'
import { addRole, testAccess } from './test-access'

let database: PlatformDatabase
let deps: AccessDeps
beforeEach(() => {
  database = openTestDatabase()
  deps = testAccess(database.db)
  addRole(database.db, 'developer')
  addRole(database.db, 'support')
})
afterEach(() => database.close())

const NOTHING = { issues: 'none', uptime: 'none', deployments: 'none', team: 'none' }

describe('resolveActorRungs', () => {
  it('gives the admin the top rung of every ladder without any grant', () => {
    expect(database.db.select().from(roleGrants).all()).toEqual([])
    expect(resolveActorRungs(deps, { roles: ['admin'] })).toEqual({ issues: 'full', uptime: 'full', deployments: 'full', team: 'full' })
    expect(resolveActorRungs(deps, { roles: ['developer', 'admin'] }).team).toBe('full')
  })

  it('resolves an ungranted capability to none', () => {
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } })
    const rungs = resolveActorRungs(deps, { roles: ['developer'] })
    expect(rungs).toEqual({ ...NOTHING, team: 'read' })
    expect(rungOf(rungs, 'uptime')).toBe('none')
    expect(rungOf(rungs, 'bots')).toBe('none')
    expect(resolveActorRungs(deps, { roles: [] })).toEqual(NOTHING)
    expect(resolveActorRungs(deps, { roles: ['nobody'] })).toEqual(NOTHING)
  })

  it('takes the higher of two grants across roles', () => {
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } })
    setGrant(deps, { role: 'support', target: { kind: 'capability', id: 'team' }, rungs: { team: 'full' } })
    expect(resolveActorRungs(deps, { roles: ['developer'] }).team).toBe('read')
    expect(resolveActorRungs(deps, { roles: ['developer', 'support'] }).team).toBe('full')
    expect(resolveActorRungs(deps, { roles: ['support', 'developer'] }).team).toBe('full')
  })

  it('takes the higher of a module grant and a standalone grant on one role', () => {
    setGrant(deps, { role: 'developer', target: { kind: 'module', id: 'operations' }, rungs: { deployments: 'full' } })
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'deployments' }, rungs: { deployments: 'read' } })
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'uptime' }, rungs: { uptime: 'full' } })
    expect(resolveActorRungs(deps, { roles: ['developer'] })).toEqual({ ...NOTHING, uptime: 'full', deployments: 'full' })
  })

  it('resolves a capability that sits in two modules', () => {
    setGrant(deps, { role: 'developer', target: { kind: 'module', id: 'operations' }, rungs: {} })
    expect(resolveActorRungs(deps, { roles: ['developer'] })).toEqual({ ...NOTHING, uptime: 'read' })

    setGrant(deps, { role: 'support', target: { kind: 'module', id: 'issues' }, rungs: { uptime: 'none' } })
    expect(resolveActorRungs(deps, { roles: ['support'] })).toEqual({ ...NOTHING, issues: 'read' })
    expect(resolveActorRungs(deps, { roles: ['developer', 'support'] })).toEqual({ ...NOTHING, issues: 'read', uptime: 'read' })

    setGrant(deps, { role: 'support', target: { kind: 'module', id: 'issues' }, rungs: {} })
    expect(resolveActorRungs(deps, { roles: ['developer', 'support'] })).toEqual({ ...NOTHING, issues: 'read', uptime: 'full' })
  })

  it('gives a module member added after the grant its default rung', () => {
    setGrant(deps, { role: 'developer', target: { kind: 'module', id: 'operations' }, rungs: {} })
    database.db.update(roleGrants).set({ rungs: {} }).run()
    expect(resolveActorRungs(deps, { roles: ['developer'] })).toEqual({ ...NOTHING, uptime: 'read' })
  })

  it('ignores stored rungs and targets that no longer exist', () => {
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'full' } })
    database.db.update(roleGrants).set({ rungs: { team: 'owner' } }).run()
    expect(resolveActorRungs(deps, { roles: ['developer'] })).toEqual(NOTHING)

    database.db.update(roleGrants).set({ targetId: 'bots', rungs: { bots: 'full' } }).run()
    expect(resolveActorRungs(deps, { roles: ['developer'] })).toEqual(NOTHING)
  })

  it('fails closed when the grants cannot be read', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    setGrant(deps, { role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'full' } })
    database.close()
    expect(resolveRoleRungs(deps, ['developer'])).toEqual(NOTHING)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Rung resolution failed'))
    error.mockRestore()
    database = openTestDatabase()
  })
})
