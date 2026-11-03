import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { inspect } from 'node:util'

export const SECRETS_KEY_ENV = 'CM_SECRETS_KEY'

const KEY_BYTES = 32
const IV_BYTES = 12
const ALGORITHM = 'aes-256-gcm'
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export interface Sealed {
  iv: string
  tag: string
  data: string
}

export class MasterKey {
  readonly #key: Buffer

  private constructor(key: Buffer) {
    this.#key = key
  }

  static parse(encoded: string): MasterKey {
    const trimmed = encoded.trim()
    const bytes = BASE64.test(trimmed) ? Buffer.from(trimmed, 'base64') : undefined
    if (bytes?.length !== KEY_BYTES) {
      throw new Error(`${SECRETS_KEY_ENV} must be ${KEY_BYTES} bytes encoded as base64 (generate one with: openssl rand -base64 32)`)
    }
    return new MasterKey(bytes)
  }

  static generate(): MasterKey {
    return new MasterKey(randomBytes(KEY_BYTES))
  }

  seal(plaintext: string, aad: string): Sealed {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, this.#key, iv)
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  }

  open(sealed: Sealed, aad: string): string {
    const decipher = createDecipheriv(ALGORITHM, this.#key, Buffer.from(sealed.iv, 'base64'))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8')
  }

  toJSON(): string {
    return '[redacted]'
  }

  toString(): string {
    return '[redacted]'
  }

  [inspect.custom](): string {
    return 'MasterKey [redacted]'
  }
}
