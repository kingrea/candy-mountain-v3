import { randomUUID } from 'node:crypto'
import {
  ADMIN_ROLE,
  ADMIN_USERNAME,
  HEALTH_PATH,
  INFO_PATH,
  ME_PATH,
  PROJECTS_PATH,
  type ApiErrorBody,
  type MeResponse,
} from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { users } from '../db/schema'
import { openTestDatabase } from '../testing'
import { createAuthStrategy } from './strategy'

const UNAUTHENTICATED: ApiErrorBody = { error: { code: 'unauthenticated', message: 'Authentication required' } }

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase()
})
afterEach(() => database.close())

function addUser(username: string) {
  const now = new Date().toISOString()
  database.db.insert(users).values({ id: randomUUID(), username, displayName: username, createdAt: now, updatedAt: now }).run()
}

describe('development strategy', () => {
  function app() {
    return createApp({ db: database.db, paths: dataPaths('/unused'), auth: createAuthStrategy({ strategy: 'development' }) })
  }

  it('resolves every request as the admin, whatever it sends', async () => {
    addUser('jack')
    const attempts: Record<string, string>[] = [{}, { 'x-forwarded-user': 'jack' }, { cookie: 'session=forged' }]
    for (const headers of attempts) {
      const res = await app().request(ME_PATH, { headers })
      expect(res.status).toBe(200)
      const { actor } = await res.json() as MeResponse
      expect(actor).toMatchObject({ username: ADMIN_USERNAME, displayName: 'Admin', roles: [ADMIN_ROLE] })
      expect(actor.id).toMatch(/^[0-9a-f-]{36}$/)
    }
  })

  it('lets protected routes through', async () => {
    expect((await app().request(PROJECTS_PATH)).status).toBe(200)
  })

  it('is the default when no strategy is given', async () => {
    const res = await createApp({ db: database.db, paths: dataPaths('/unused') }).request(ME_PATH)
    expect((await res.json() as MeResponse).actor.username).toBe(ADMIN_USERNAME)
  })

  it('yields 401 when the admin user does not exist', async () => {
    const unseeded = openTestDatabase({ seed: false })
    try {
      const res = await createApp({ db: unseeded.db, paths: dataPaths('/unused') }).request(ME_PATH)
      expect(res.status).toBe(401)
    }
    finally {
      unseeded.close()
    }
  })
})

describe('trusted-header strategy', () => {
  function app() {
    return createApp({
      db: database.db,
      paths: dataPaths('/unused'),
      auth: createAuthStrategy({ strategy: 'trusted-header', header: 'x-forwarded-user' }),
    })
  }

  it('resolves the user named by the header', async () => {
    addUser('jack')
    const res = await app().request(ME_PATH, { headers: { 'X-Forwarded-User': 'jack' } })
    expect(res.status).toBe(200)
    expect((await res.json() as MeResponse).actor).toMatchObject({ username: 'jack', roles: [] })

    const admin = await app().request(ME_PATH, { headers: { 'x-forwarded-user': ADMIN_USERNAME } })
    expect((await admin.json() as MeResponse).actor).toMatchObject({ username: ADMIN_USERNAME, roles: [ADMIN_ROLE] })
  })

  it('yields 401 for a missing, empty or unknown identity on every protected route', async () => {
    const attempts: Record<string, string>[] = [{}, { 'x-forwarded-user': '  ' }, { 'x-forwarded-user': 'stranger' }, { 'x-other': ADMIN_USERNAME }]
    for (const headers of attempts) {
      for (const path of [ME_PATH, INFO_PATH, PROJECTS_PATH, '/no-such-route']) {
        const res = await app().request(path, { headers })
        expect(res.status, `${path} ${JSON.stringify(headers)}`).toBe(401)
        expect(await res.json()).toEqual(UNAUTHENTICATED)
      }
    }
  })

  it('keeps the health check public', async () => {
    const res = await app().request(HEALTH_PATH)
    expect(res.status).toBe(200)
  })

  it('reports itself on the info route', async () => {
    const res = await app().request(INFO_PATH, { headers: { 'x-forwarded-user': ADMIN_USERNAME } })
    expect(await res.json()).toMatchObject({ authStrategy: 'trusted-header' })
  })
})
