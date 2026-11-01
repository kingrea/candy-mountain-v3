import { FORBIDDEN_ERROR_CODE, GRANTS_PATH, type Actor, type GrantListResponse, type GrantResponse } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/platform'
import type { AuthStrategy } from '../auth'
import type { PlatformDatabase } from '../db'
import { openTestDatabase } from '../testing'
import { seedAdminGrants } from './seed'
import { addRole, testAccess } from './test-access'

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase()
  addRole(database.db, 'developer')
  seedAdminGrants(testAccess(database.db))
})
afterEach(() => database.close())

const as = (roles: string[]): AuthStrategy => ({
  name: 'development',
  resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }),
})

function app(roles = ['admin']) {
  const { capabilities, modules } = testAccess(database.db)
  return createTestApp({ db: database.db, paths: {} as never, capabilities, modules, auth: as(roles) })
}

const put = (body: unknown, roles?: string[]) =>
  app(roles).request(GRANTS_PATH, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('grant routes', () => {
  it('lists grants and each role\'s resolved rungs', async () => {
    const res = await app().request(GRANTS_PATH)
    expect(res.status).toBe(200)
    const body = await res.json() as GrantListResponse
    expect(body.grants.map(g => `${g.role}:${g.target.kind}:${g.target.id}`)).toEqual(['admin:module:agent-hub', 'admin:module:issues', 'admin:module:operations'])
    expect(body.roles).toEqual([
      { role: 'admin', name: 'Administrator', rungs: { issues: 'full', uptime: 'full', deployments: 'full', team: 'full' } },
      { role: 'developer', name: 'developer', rungs: { issues: 'none', uptime: 'none', deployments: 'none', team: 'none' } },
    ])
  })

  it('sets a grant and reflects it in the list', async () => {
    const res = await put({ role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } })
    expect(res.status).toBe(200)
    expect((await res.json() as GrantResponse).grant).toMatchObject({ role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } })
    const list = await (await app().request(GRANTS_PATH)).json() as GrantListResponse
    expect(list.roles.find(r => r.role === 'developer')!.rungs.team).toBe('read')
  })

  it('returns error bodies for bad requests', async () => {
    const cases: [unknown, number, string][] = [
      ['{', 400, 'invalid_request'],
      [{ role: 'developer', target: { kind: 'project', id: 'x' } }, 400, 'invalid_request'],
      [{ role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 3 } }, 400, 'invalid_request'],
      [{ role: 'ghost', target: { kind: 'capability', id: 'team' }, rungs: { team: 'read' } }, 422, 'role_not_found'],
      [{ role: 'developer', target: { kind: 'capability', id: 'bots' }, rungs: { bots: 'read' } }, 422, 'target_not_found'],
      [{ role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'owner' } }, 422, 'invalid_rung'],
    ]
    for (const [body, status, code] of cases) {
      const res = await put(body)
      expect(res.status, JSON.stringify(body)).toBe(status)
      expect(await res.json()).toEqual({ error: { code, message: expect.any(String) } })
    }
  })

  it('is admin only', async () => {
    const list = await app(['developer']).request(GRANTS_PATH)
    expect(list.status).toBe(403)
    expect(await list.json()).toEqual({ error: { code: FORBIDDEN_ERROR_CODE, message: 'Only the admin may do this' } })
    const set = await put({ role: 'developer', target: { kind: 'capability', id: 'team' }, rungs: { team: 'full' } }, ['developer'])
    expect(set.status).toBe(403)
    expect((await (await app().request(GRANTS_PATH)).json() as GrantListResponse).grants).toHaveLength(3)
  })
})
