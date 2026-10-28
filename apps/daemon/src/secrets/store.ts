import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { SECRETS_KEY_ENV, type MasterKey, type Sealed } from './master-key'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/
const FILE_SUFFIX = '.json'
const FORMAT_VERSION = 1

// Deliberately has no way to read a value back, so it is the only shape HTTP-facing code may hold.
export interface SecretsWriter {
  readonly unlocked: boolean
  set(owner: string, name: string, value: string): void
  isSet(owner: string, name: string): boolean
  delete(owner: string, name: string): boolean
  deleteOwner(owner: string): number
}

export interface SecretsStore extends SecretsWriter {
  get(owner: string, name: string): string | undefined
  readonly writeOnly: SecretsWriter
}

export class SecretsLockedError extends Error {
  override name = 'SecretsLockedError'

  constructor() {
    super(`${SECRETS_KEY_ENV} is not set, so secrets cannot be written or read`)
  }
}

export class SecretDecryptError extends Error {
  override name = 'SecretDecryptError'

  constructor(owner: string, secretName: string) {
    super(`Secret "${secretName}" of "${owner}" could not be decrypted; ${SECRETS_KEY_ENV} may differ from the key it was written with`)
  }
}

export class InvalidSecretIdError extends Error {
  override name = 'InvalidSecretIdError'
}

interface SecretFile extends Sealed {
  version: number
}

export function createSecretsStore(dir: string, key: MasterKey | undefined): SecretsStore {
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  function ownerDir(owner: string): string {
    assertId('owner', owner)
    return join(dir, owner)
  }

  function secretFile(owner: string, name: string): string {
    assertId('secret name', name)
    return join(ownerDir(owner), name + FILE_SUFFIX)
  }

  function requireKey(): MasterKey {
    if (!key) throw new SecretsLockedError()
    return key
  }

  function set(owner: string, name: string, value: string): void {
    const file = secretFile(owner, name)
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`Secret "${name}" of "${owner}" must be a non-empty string`)
    }
    const sealed = requireKey().seal(value, aad(owner, name))
    mkdirSync(ownerDir(owner), { recursive: true, mode: 0o700 })
    writeAtomic(file, JSON.stringify({ version: FORMAT_VERSION, ...sealed } satisfies SecretFile))
  }

  function get(owner: string, name: string): string | undefined {
    const file = secretFile(owner, name)
    const masterKey = requireKey()
    if (!existsSync(file)) return undefined
    try {
      const sealed = JSON.parse(readFileSync(file, 'utf8')) as SecretFile
      return masterKey.open(sealed, aad(owner, name))
    }
    catch {
      // Swallow the cause so nothing derived from the file or key can surface in a log.
      throw new SecretDecryptError(owner, name)
    }
  }

  function isSet(owner: string, name: string): boolean {
    return existsSync(secretFile(owner, name))
  }

  function del(owner: string, name: string): boolean {
    const file = secretFile(owner, name)
    if (!existsSync(file)) return false
    rmSync(file)
    try {
      rmdirSync(ownerDir(owner))
    }
    catch {
      // Other secrets still live there.
    }
    return true
  }

  function deleteOwner(owner: string): number {
    const target = ownerDir(owner)
    if (!existsSync(target)) return 0
    const count = readdirSync(target).filter(entry => entry.endsWith(FILE_SUFFIX)).length
    rmSync(target, { recursive: true, force: true })
    return count
  }

  const writeOnly: SecretsWriter = Object.freeze({
    get unlocked() {
      return key !== undefined
    },
    set,
    isSet,
    delete: del,
    deleteOwner,
  })

  return Object.freeze({
    get unlocked() {
      return key !== undefined
    },
    set,
    isSet,
    delete: del,
    deleteOwner,
    get,
    writeOnly,
  })
}

// Binding owner and name into the tag stops a ciphertext file being moved to another slot and decrypting there.
function aad(owner: string, name: string): string {
  return `${owner}\0${name}`
}

function assertId(kind: string, value: string): void {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new InvalidSecretIdError(`Invalid ${kind} "${String(value)}": use 1-128 of letters, digits and . _ : @ -, starting with a letter or digit`)
  }
}

function writeAtomic(file: string, content: string): void {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    const fd = openSync(temp, 'wx', 0o600)
    try {
      writeSync(fd, content)
      fsyncSync(fd)
    }
    finally {
      closeSync(fd)
    }
    renameSync(temp, file)
  }
  catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}
