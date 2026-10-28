import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { ADMIN_USERNAME } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { authSessions, userPasswords, users } from '../db/schema'

export const ADMIN_PASSWORD_ENV = 'CM_ADMIN_PASSWORD'
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 1024

export interface ScryptParams {
  N: number
  r: number
  p: number
}

// OWASP's scrypt baseline; node:crypto keeps the daemon free of native hashing dependencies.
export const DEFAULT_SCRYPT_PARAMS: Readonly<ScryptParams> = { N: 2 ** 17, r: 8, p: 1 }

/** Cheap preset so tests that log in repeatedly stay fast under load. */
export const LOW_COST_SCRYPT_PARAMS: Readonly<ScryptParams> = { N: 2 ** 10, r: 8, p: 1 }

const KEY_LENGTH = 64
const SALT_LENGTH = 16

function deriveKey(password: string, salt: Buffer, { N, r, p }: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r }
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) => error ? reject(error) : resolve(key))
  })
}

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const key = await deriveKey(password, salt, params)
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number]
  if (![N, r, p].every(n => Number.isSafeInteger(n) && n > 0)) return false
  const salt = Buffer.from(parts[4]!, 'base64')
  const expected = Buffer.from(parts[5]!, 'base64')
  if (expected.length !== KEY_LENGTH) return false
  return timingSafeEqual(await deriveKey(password, salt, { N, r, p }), expected)
}

const dummyHashes = new Map<string, Promise<string>>()

/** Burns the same time as a real check so an unknown username is not distinguishable by latency. */
export async function verifyAgainstDummy(password: string, hashing: ScryptParams = DEFAULT_SCRYPT_PARAMS): Promise<false> {
  const key = `${hashing.N}/${hashing.r}/${hashing.p}`
  let dummy = dummyHashes.get(key)
  if (!dummy) {
    dummy = hashPassword(randomBytes(16).toString('hex'), hashing)
    dummyHashes.set(key, dummy)
  }
  await verifyPassword(password, await dummy)
  return false
}

export function hasPassword(db: Db, userId: string): boolean {
  return db.select({ userId: userPasswords.userId }).from(userPasswords).where(eq(userPasswords.userId, userId)).get() !== undefined
}

export function getPasswordHash(db: Db, userId: string): string | null {
  return db.select({ hash: userPasswords.passwordHash }).from(userPasswords).where(eq(userPasswords.userId, userId)).get()?.hash ?? null
}

export function validateNewPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
}

/** Stores a new hash and signs the user out everywhere. */
export async function setUserPassword(db: Db, userId: string, password: string, hashing?: ScryptParams): Promise<void> {
  validateNewPassword(password)
  const passwordHash = await hashPassword(password, hashing)
  const now = new Date().toISOString()
  db.transaction((tx) => {
    tx.insert(userPasswords)
      .values({ userId, passwordHash, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: userPasswords.userId, set: { passwordHash, updatedAt: now } })
      .run()
    tx.delete(authSessions).where(eq(authSessions.userId, userId)).run()
  })
}

export function requireAdminPassword(db: Db): void {
  const admin = db.select({ id: users.id }).from(users).where(eq(users.username, ADMIN_USERNAME)).get()
  if (!admin || !hasPassword(db, admin.id)) {
    throw new Error(`The password strategy needs an admin password: start the daemon once with ${ADMIN_PASSWORD_ENV} set`)
  }
}

export type AdminPasswordResult = 'set' | 'unchanged'

/** Applies CM_ADMIN_PASSWORD at boot; a matching hash is left alone so restarts keep existing sessions. */
export async function applyAdminPassword(db: Db, password: string, hashing?: ScryptParams): Promise<AdminPasswordResult> {
  const admin = db.select({ id: users.id }).from(users).where(eq(users.username, ADMIN_USERNAME)).get()
  if (!admin) throw new Error(`The ${ADMIN_USERNAME} user does not exist`)
  const current = getPasswordHash(db, admin.id)
  if (current && await verifyPassword(password, current)) return 'unchanged'
  await setUserPassword(db, admin.id, password, hashing)
  return 'set'
}
