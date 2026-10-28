import { CAPABILITY_CATALOG_PATH, type Actor, type CapabilityCatalogResponse } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import type { PlatformDatabase } from '../db'
import { testAccess } from '../grants/test-access'
import { openTestDatabase } from '../testing'

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase()
})
afterEach(() => database.close())

const as = (roles: string[]): AuthStrategy => ({
  name: 'development',
  resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }),
})

function request(roles: string[]) {
  const { capabilities, modules } = testAccess(database.db)
  return createApp({ db: database.db, paths: {} as never, capabilities, modules, auth: as(roles) }).request(CAPABILITY_CATALOG_PATH)
}

describe('capability catalog route', () => {
  it('lists capabilities with their modules and rung names', async () => {
    const res = await request(['admin'])
    expect(res.status).toBe(200)
    const body = await res.json() as CapabilityCatalogResponse
    expect(body.capabilities.length).toBeGreaterThan(0)
    for (const cap of body.capabilities) expect(cap.rungs[0]).toMatchObject({ name: 'none' })
    expect(body.modules.map(m => m.id)).toEqual(expect.arrayContaining(['issues', 'agent-hub', 'operations']))
  })

  it('is admin only', async () => {
    expect((await request(['developer'])).status).toBe(403)
  })
})
