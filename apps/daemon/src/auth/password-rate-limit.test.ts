import { ADMIN_USERNAME, LOGIN_PATH, type ApiErrorBody } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/platform'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { openTestDatabase } from '../testing'
import { findActorByUsername } from './actors'
import { LOW_COST_SCRYPT_PARAMS, setUserPassword } from './passwords'
import { passwordStrategy } from './password'

const PASSWORD = 'correct horse battery'
const WINDOW_MS = 60_000

let database: PlatformDatabase
let now: Date
let app: ReturnType<typeof createTestApp>

beforeEach(async () => {
  database = openTestDatabase()
  now = new Date('2026-01-01T00:00:00Z')
  await setUserPassword(database.db, findActorByUsername(database.db, ADMIN_USERNAME)!.id, PASSWORD, LOW_COST_SCRYPT_PARAMS)
  app = createTestApp({
    db: database.db,
    paths: dataPaths('/unused'),
    auth: passwordStrategy({
      sessionTtlMs: 3_600_000,
      secureCookie: false,
      loginRateLimit: { maxFailures: 10, windowMs: WINDOW_MS },
      clock: { now: () => now },
      hashing: LOW_COST_SCRYPT_PARAMS,
    }),
  })
})
afterEach(() => database.close())

function login(username: string, password: string, ip = '10.0.0.1') {
  return app.request(
    LOGIN_PATH,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) },
    { incoming: { socket: { remoteAddress: ip } } },
  )
}

async function fail(username: string, times: number, ip?: string) {
  for (let i = 0; i < times; i++) expect((await login(username, 'wrong password', ip)).status).toBe(401)
}

describe('login rate limiting', () => {
  it('answers the eleventh attempt after ten failures with 429 and Retry-After', async () => {
    await fail(ADMIN_USERNAME, 10)
    now = new Date(now.getTime() + 20_000)
    const res = await login(ADMIN_USERNAME, PASSWORD)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('40')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect((await res.json() as ApiErrorBody).error.code).toBe('rate_limited')
  })

  it('accepts the correct password once the window has passed', async () => {
    await fail(ADMIN_USERNAME, 10)
    expect((await login(ADMIN_USERNAME, PASSWORD)).status).toBe(429)
    now = new Date(now.getTime() + WINDOW_MS + 1)
    expect((await login(ADMIN_USERNAME, PASSWORD)).status).toBe(200)
  })

  it('counts a username across IPs but leaves other usernames and IPs alone', async () => {
    await fail(ADMIN_USERNAME, 5, '10.0.0.1')
    await fail(ADMIN_USERNAME, 5, '10.0.0.2')
    expect((await login(ADMIN_USERNAME, PASSWORD, '10.0.0.3')).status).toBe(429)
    expect((await login('other', 'wrong password', '10.0.0.3')).status).toBe(401)
  })

  it('limits an IP across usernames', async () => {
    for (let i = 0; i < 10; i++) await login(`user${i}`, 'wrong password', '10.0.0.9')
    expect((await login(ADMIN_USERNAME, PASSWORD, '10.0.0.9')).status).toBe(429)
    expect((await login(ADMIN_USERNAME, PASSWORD, '10.0.0.8')).status).toBe(200)
  })

  it('clears the username counter on success', async () => {
    await fail(ADMIN_USERNAME, 9, '10.0.0.1')
    expect((await login(ADMIN_USERNAME, PASSWORD, '10.0.0.2')).status).toBe(200)
    await fail(ADMIN_USERNAME, 9, '10.0.0.3')
    expect((await login(ADMIN_USERNAME, PASSWORD, '10.0.0.4')).status).toBe(200)
  })

  it('ignores X-Forwarded-For', async () => {
    for (let i = 0; i < 10; i++) {
      await app.request(
        LOGIN_PATH,
        { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `1.1.1.${i}` }, body: JSON.stringify({ username: `u${i}`, password: 'x' }) },
        { incoming: { socket: { remoteAddress: '10.0.0.5' } } },
      )
    }
    expect((await login(ADMIN_USERNAME, PASSWORD, '10.0.0.5')).status).toBe(429)
  })
})
