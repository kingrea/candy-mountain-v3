import { ADMIN_ROLE, ADMIN_USERNAME } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { roles, userRoles, users } from '../db/schema'
import { startPlatform } from '../platform'
import { createTempDataDir, openTestDatabase } from '../testing'
import { findActorByUsername } from './actors'
import { seedAuth } from './seed'

describe('seedAuth', () => {
  it('creates the admin user holding the admin role, once', () => {
    const database = openTestDatabase({ seed: false })
    try {
      seedAuth(database.db)
      seedAuth(database.db)
      expect(database.db.select().from(users).all()).toHaveLength(1)
      expect(database.db.select().from(roles).all()).toMatchObject([{ slug: ADMIN_ROLE }])
      expect(database.db.select().from(userRoles).all()).toHaveLength(1)
      expect(findActorByUsername(database.db, ADMIN_USERNAME)).toMatchObject({ username: ADMIN_USERNAME, roles: [ADMIN_ROLE] })
    }
    finally {
      database.close()
    }
  })

  it('seeds at boot and keeps the same admin across restarts', () => {
    const temp = createTempDataDir()
    const first = startPlatform(temp.root)
    const admin = findActorByUsername(first.db, ADMIN_USERNAME)
    first.close()
    expect(admin).toMatchObject({ roles: [ADMIN_ROLE] })

    const second = startPlatform(temp.root)
    try {
      expect(findActorByUsername(second.db, ADMIN_USERNAME)).toEqual(admin)
      expect(second.db.select().from(users).all()).toHaveLength(1)
    }
    finally {
      second.close()
      temp.cleanup()
    }
  })
})
