import { ADMIN_USERNAME } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlatformDatabase } from '../db'
import { authSessions, userPasswords } from '../db/schema'
import { openTestDatabase } from '../testing'
import { findActorByUsername } from './actors'
import { applyAdminPassword, getPasswordHash, DEFAULT_SCRYPT_PARAMS, LOW_COST_SCRYPT_PARAMS, hashPassword, requireAdminPassword, setUserPassword, verifyPassword, type ScryptParams } from './passwords'
import { createSession } from './sessions'

const FAST: ScryptParams = LOW_COST_SCRYPT_PARAMS

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase()
})
afterEach(() => database.close())

describe('production scrypt defaults', () => {
  it('use N=2^17, r=8, p=1 and are what stored hashes carry', async () => {
    expect(DEFAULT_SCRYPT_PARAMS).toEqual({ N: 131072, r: 8, p: 1 })
    const id = findActorByUsername(database.db, ADMIN_USERNAME)!.id
    await setUserPassword(database.db, id, 'correct horse')
    const stored = getPasswordHash(database.db, id)!
    expect(stored).toMatch(/^scrypt\$131072\$8\$1\$/)
    expect(await verifyPassword('correct horse', stored)).toBe(true)
  }, 30_000)
})

describe('hashPassword', () => {
  it('produces salted scrypt hashes that verify only the original password', async () => {
    const first = await hashPassword('correct horse', FAST)
    const second = await hashPassword('correct horse', FAST)
    expect(first).toMatch(/^scrypt\$1024\$8\$1\$[\w+/=]+\$[\w+/=]+$/)
    expect(first).not.toBe(second)
    expect(first).not.toContain('correct horse')
    expect(await verifyPassword('correct horse', first)).toBe(true)
    expect(await verifyPassword('correct horsf', first)).toBe(false)
  })

  it('rejects malformed stored hashes', async () => {
    for (const stored of ['', 'plain', 'bcrypt$1$2$3$4$5', 'scrypt$x$8$1$AAAA$AAAA', 'scrypt$1024$8$1$AAAA$AAAA']) {
      expect(await verifyPassword('anything', stored)).toBe(false)
    }
  })
})

describe('applyAdminPassword', () => {
  const adminId = () => findActorByUsername(database.db, ADMIN_USERNAME)!.id

  it('sets the hash once and keeps sessions while the password is unchanged', async () => {
    expect(await applyAdminPassword(database.db, 'first password', FAST)).toBe('set')
    const hash = getPasswordHash(database.db, adminId())
    createSession(database.db, adminId(), 60_000)
    expect(await applyAdminPassword(database.db, 'first password', FAST)).toBe('unchanged')
    expect(getPasswordHash(database.db, adminId())).toBe(hash)
    expect(database.db.select().from(authSessions).all()).toHaveLength(1)
  })

  it('resets a changed password and signs the admin out', async () => {
    await applyAdminPassword(database.db, 'first password', FAST)
    createSession(database.db, adminId(), 60_000)
    expect(await applyAdminPassword(database.db, 'second password', FAST)).toBe('set')
    expect(await verifyPassword('second password', getPasswordHash(database.db, adminId())!)).toBe(true)
    expect(database.db.select().from(authSessions).all()).toHaveLength(0)
    expect(database.db.select().from(userPasswords).all()).toHaveLength(1)
  })

  it('refuses passwords that are too short', async () => {
    await expect(applyAdminPassword(database.db, 'short', FAST)).rejects.toThrow(/at least 8/)
  })
})

describe('requireAdminPassword', () => {
  it('fails until the admin has a password', async () => {
    expect(() => requireAdminPassword(database.db)).toThrow(/CM_ADMIN_PASSWORD/)
    await applyAdminPassword(database.db, 'first password', FAST)
    expect(() => requireAdminPassword(database.db)).not.toThrow()
  })
})
