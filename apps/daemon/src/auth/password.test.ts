import {
  ADMIN_ROLE,
  ADMIN_USERNAME,
  AUTH_STRATEGY_PATH,
  INFO_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  ME_PATH,
  SESSION_COOKIE_NAME,
  type ApiErrorBody,
  type AuthStrategyResponse,
  type LoginResponse,
  type MeResponse,
} from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { authSessions, users } from '../db/schema'
import { openTestDatabase } from '../testing'
import { findActorByUsername } from './actors'
import { LOW_COST_SCRYPT_PARAMS, getPasswordHash, setUserPassword } from './passwords'
import { createAuthStrategy } from './strategy'
import { passwordStrategy } from './password'

const PASSWORD = 'correct horse battery'
const TTL_MS = 60 * 60_000

let database: PlatformDatabase
let now: Date
beforeEach(async () => {
  database = openTestDatabase()
  now = new Date('2026-01-01T00:00:00Z')
  await setUserPassword(database.db, adminId(), PASSWORD, LOW_COST_SCRYPT_PARAMS)
})
afterEach(() => database.close())

function adminId() {
  return findActorByUsername(database.db, ADMIN_USERNAME)!.id
}

function app({ secureCookie = false } = {}) {
  return createApp({
    db: database.db,
    paths: dataPaths('/unused'),
    auth: passwordStrategy({ sessionTtlMs: TTL_MS, secureCookie, clock: { now: () => now }, hashing: LOW_COST_SCRYPT_PARAMS }),
  })
}

function login(body: unknown, target = app()) {
  return target.request(LOGIN_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

function sessionCookie(res: Response): string {
  const match = new RegExp(`^${SESSION_COOKIE_NAME}=([^;]+)`).exec(res.headers.get('set-cookie') ?? '')
  if (!match) throw new Error('no session cookie set')
  return `${SESSION_COOKIE_NAME}=${match[1]}`
}

function me(cookie?: string) {
  return app().request(ME_PATH, { headers: cookie ? { cookie } : {} })
}

const sessionCount = () => database.db.select().from(authSessions).all().length

describe('password strategy', () => {
  it('logs in with the right password, sets an HttpOnly Lax cookie and resolves the admin afterwards', async () => {
    const res = await login({ username: ADMIN_USERNAME, password: PASSWORD })
    expect(res.status).toBe(200)
    expect((await res.json() as LoginResponse).actor).toMatchObject({ username: ADMIN_USERNAME, roles: [ADMIN_ROLE] })

    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[\\w-]{43};`))
    expect(setCookie).toContain('Max-Age=3600')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).not.toContain('Secure')

    const cookie = sessionCookie(res)
    const resolved = await me(cookie)
    expect(resolved.status).toBe(200)
    expect((await resolved.json() as MeResponse).actor).toMatchObject({ id: adminId(), roles: [ADMIN_ROLE] })
    expect((await app().request(INFO_PATH, { headers: { cookie } })).status).toBe(200)
  })

  it('stores only a hash of the session token', async () => {
    const cookie = sessionCookie(await login({ username: ADMIN_USERNAME, password: PASSWORD }))
    const [row] = database.db.select().from(authSessions).all()
    expect(row).toMatchObject({ userId: adminId(), expiresAt: '2026-01-01T01:00:00.000Z' })
    expect(cookie).not.toContain(row!.id)
  })

  it('marks the cookie Secure when configured', async () => {
    const res = await login({ username: ADMIN_USERNAME, password: PASSWORD }, app({ secureCookie: true }))
    expect(res.headers.get('set-cookie')).toContain('Secure')
  })

  it('answers a wrong password or unknown user with 401 and no session', async () => {
    for (const body of [{ username: ADMIN_USERNAME, password: 'wrong password' }, { username: 'stranger', password: PASSWORD }]) {
      const res = await login(body)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: { code: 'invalid_credentials', message: 'Invalid username or password' } })
      expect(res.headers.get('set-cookie')).toBeNull()
    }
    expect(sessionCount()).toBe(0)
  })

  it('rejects malformed login bodies with 400', async () => {
    for (const body of [null, {}, { username: ADMIN_USERNAME }, { username: '', password: PASSWORD }, { username: ADMIN_USERNAME, password: 1 }]) {
      const res = await login(body)
      expect(res.status).toBe(400)
      expect((await res.json() as ApiErrorBody).error.code).toBe('invalid_request')
    }
    const notJson = await app().request(LOGIN_PATH, { method: 'POST', body: 'username=admin' })
    expect(notJson.status).toBe(400)
  })

  it('yields 401 without a cookie or with an unknown one', async () => {
    expect((await me()).status).toBe(401)
    expect((await me(`${SESSION_COOKIE_NAME}=forged`)).status).toBe(401)
    expect((await me('x-forwarded-user=admin')).status).toBe(401)
  })

  it('invalidates the session on logout and clears the cookie', async () => {
    const cookie = sessionCookie(await login({ username: ADMIN_USERNAME, password: PASSWORD }))
    const res = await app().request(LOGOUT_PATH, { method: 'POST', headers: { cookie } })
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;.*Max-Age=0.*Path=/`))
    expect(sessionCount()).toBe(0)
    expect((await me(cookie)).status).toBe(401)
  })

  it('lets logout through without a valid session', async () => {
    expect((await app().request(LOGOUT_PATH, { method: 'POST' })).status).toBe(204)
    expect((await app().request(LOGOUT_PATH, { method: 'POST', headers: { cookie: `${SESSION_COOKIE_NAME}=gone` } })).status).toBe(204)
  })

  it('expires sessions after the configured lifetime', async () => {
    const cookie = sessionCookie(await login({ username: ADMIN_USERNAME, password: PASSWORD }))
    now = new Date(now.getTime() + TTL_MS - 1)
    expect((await me(cookie)).status).toBe(200)
    now = new Date(now.getTime() + 1)
    const expired = await me(cookie)
    expect(expired.status).toBe(401)
    expect(await expired.json()).toMatchObject({ error: { code: 'unauthenticated' } })
    expect(sessionCount()).toBe(0)
  })

  it('replaces the previous session on a new login and purges expired ones', async () => {
    const first = sessionCookie(await login({ username: ADMIN_USERNAME, password: PASSWORD }))
    const res = await app().request(LOGIN_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': first },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: PASSWORD }),
    })
    expect(sessionCount()).toBe(1)
    expect((await me(first)).status).toBe(401)
    expect((await me(sessionCookie(res))).status).toBe(200)

    now = new Date(now.getTime() + TTL_MS)
    await login({ username: ADMIN_USERNAME, password: PASSWORD })
    expect(sessionCount()).toBe(1)
  })

  it('drops sessions when the user is deleted', async () => {
    const cookie = sessionCookie(await login({ username: ADMIN_USERNAME, password: PASSWORD }))
    database.db.delete(users).where(eq(users.id, adminId())).run()
    expect(sessionCount()).toBe(0)
    expect((await me(cookie)).status).toBe(401)
  })

  it('never returns the password hash', async () => {
    const hash = getPasswordHash(database.db, adminId())!
    const res = await login({ username: ADMIN_USERNAME, password: PASSWORD })
    const cookie = sessionCookie(res)
    const bodies = [await res.text()]
    for (const path of [ME_PATH, INFO_PATH, AUTH_STRATEGY_PATH]) {
      bodies.push(await (await app().request(path, { headers: { cookie } })).text())
    }
    for (const body of bodies) {
      expect(body).not.toContain(hash)
      expect(body).not.toMatch(/scrypt|password_?hash/i)
    }
  })
})

describe('strategy discovery', () => {
  it('reports the active strategy without authentication', async () => {
    expect(await (await app().request(AUTH_STRATEGY_PATH)).json()).toEqual<AuthStrategyResponse>({ strategy: 'password' })
    const header = createApp({
      db: database.db,
      paths: dataPaths('/unused'),
      auth: createAuthStrategy({ strategy: 'trusted-header', header: 'x-user' }),
    })
    expect(await (await header.request(AUTH_STRATEGY_PATH)).json()).toEqual({ strategy: 'trusted-header' })
    const development = createApp({ db: database.db, paths: dataPaths('/unused') })
    expect(await (await development.request(AUTH_STRATEGY_PATH)).json()).toEqual({ strategy: 'development' })
  })

  it('only offers login under the password strategy', async () => {
    const development = createApp({ db: database.db, paths: dataPaths('/unused') })
    expect((await login({ username: ADMIN_USERNAME, password: PASSWORD }, development)).status).toBe(404)
    const header = createApp({
      db: database.db,
      paths: dataPaths('/unused'),
      auth: createAuthStrategy({ strategy: 'trusted-header', header: 'x-user' }),
    })
    expect((await login({ username: ADMIN_USERNAME, password: PASSWORD }, header)).status).toBe(401)
  })
})
