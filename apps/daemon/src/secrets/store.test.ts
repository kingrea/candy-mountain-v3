import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config'
import { startTestPlatform } from '../testing/platform'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createSecretsStore, InvalidSecretIdError, MasterKey, SecretDecryptError, SecretsLockedError, type SecretsStore } from '.'

const VALUE = 'xoxb-super-secret-token-value'

describe('secrets store', () => {
  let temp: TempDataDir
  let dir: string
  let key: MasterKey
  let store: SecretsStore

  beforeEach(() => {
    temp = createTempDataDir()
    dir = join(temp.root, 'secrets')
    key = MasterKey.generate()
    store = createSecretsStore(dir, key)
  })

  afterEach(() => temp.cleanup())

  it('sets, checks, reads internally and deletes a secret', () => {
    expect(store.isSet('plugin:slack', 'botToken')).toBe(false)
    expect(store.get('plugin:slack', 'botToken')).toBeUndefined()

    store.set('plugin:slack', 'botToken', VALUE)
    expect(store.isSet('plugin:slack', 'botToken')).toBe(true)
    expect(store.get('plugin:slack', 'botToken')).toBe(VALUE)

    store.set('plugin:slack', 'botToken', 'replaced')
    expect(store.get('plugin:slack', 'botToken')).toBe('replaced')

    expect(store.delete('plugin:slack', 'botToken')).toBe(true)
    expect(store.delete('plugin:slack', 'botToken')).toBe(false)
    expect(store.isSet('plugin:slack', 'botToken')).toBe(false)
    expect(store.get('plugin:slack', 'botToken')).toBeUndefined()
  })

  it('keeps secrets of different owners apart', () => {
    store.set('bot-a', 'token', 'a')
    store.set('bot-b', 'token', 'b')
    expect(store.get('bot-a', 'token')).toBe('a')
    expect(store.get('bot-b', 'token')).toBe('b')
  })

  it('deletes every secret of an owner and nothing else', () => {
    store.set('plugin:github', 'token', VALUE)
    store.set('plugin:github', 'webhookSecret', VALUE)
    store.set('plugin:jira', 'token', VALUE)

    expect(store.deleteOwner('plugin:github')).toBe(2)
    expect(store.isSet('plugin:github', 'token')).toBe(false)
    expect(store.isSet('plugin:github', 'webhookSecret')).toBe(false)
    expect(existsSync(join(dir, 'plugin:github'))).toBe(false)
    expect(store.get('plugin:jira', 'token')).toBe(VALUE)
    expect(store.deleteOwner('plugin:github')).toBe(0)
  })

  it('fails to decrypt under a wrong master key', () => {
    store.set('bot', 'token', VALUE)
    const other = createSecretsStore(dir, MasterKey.generate())

    expect(other.isSet('bot', 'token')).toBe(true)
    expect(() => other.get('bot', 'token')).toThrow(SecretDecryptError)
  })

  it('decrypts with the same key material in a new store, as after a restart or move', () => {
    const encoded = Buffer.alloc(32, 7).toString('base64')
    createSecretsStore(dir, MasterKey.parse(encoded)).set('bot', 'token', VALUE)
    expect(createSecretsStore(dir, MasterKey.parse(encoded)).get('bot', 'token')).toBe(VALUE)
  })

  it('refuses a ciphertext moved to another owner or name', () => {
    store.set('bot-a', 'token', VALUE)
    store.set('bot-b', 'token', 'placeholder')
    renameSync(join(dir, 'bot-a', 'token.json'), join(dir, 'bot-b', 'token.json'))
    expect(() => store.get('bot-b', 'token')).toThrow(SecretDecryptError)
  })

  it('writes owner-only files that never contain the plaintext', () => {
    store.set('bot', 'token', VALUE)
    const file = join(dir, 'bot', 'token.json')

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, 'bot')).mode & 0o777).toBe(0o700)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readFileSync(file, 'utf8')).not.toContain(VALUE)
    expect(readdirSync(join(dir, 'bot'))).toEqual(['token.json'])
  })

  it('stays locked without a master key but can still check and delete', () => {
    store.set('bot', 'token', VALUE)
    const locked = createSecretsStore(dir, undefined)

    expect(locked.unlocked).toBe(false)
    expect(locked.isSet('bot', 'token')).toBe(true)
    expect(() => locked.get('bot', 'token')).toThrow(SecretsLockedError)
    expect(() => locked.set('bot', 'other', VALUE)).toThrow(SecretsLockedError)
    expect(locked.deleteOwner('bot')).toBe(1)
  })

  it('rejects owner and secret names that could escape the store', () => {
    for (const bad of ['', '.', '..', '../x', 'a/b', '.hidden', 'a\0b']) {
      expect(() => store.set(bad, 'token', VALUE)).toThrow(InvalidSecretIdError)
      expect(() => store.isSet('bot', bad)).toThrow(InvalidSecretIdError)
    }
  })

  it('keeps values out of errors', () => {
    store.set('bot', 'token', VALUE)
    const errors: unknown[] = []
    for (const attempt of [
      () => createSecretsStore(dir, MasterKey.generate()).get('bot', 'token'),
      () => createSecretsStore(dir, undefined).set('bot', 'token', VALUE),
      () => store.set('../bot', 'token', VALUE),
    ]) {
      try {
        attempt()
      }
      catch (error) {
        errors.push(error)
      }
    }

    expect(errors).toHaveLength(3)
    for (const error of errors) {
      expect(inspect(error, { depth: 5 })).not.toContain(VALUE)
      expect((error as Error).cause).toBeUndefined()
    }
  })

  it('exposes a write-only view that never returns a value', () => {
    const view = store.writeOnly
    expect(Object.keys(view).sort()).toEqual(['delete', 'deleteOwner', 'isSet', 'set', 'unlocked'])
    expect('get' in view).toBe(false)
    expect(Object.isFrozen(view)).toBe(true)

    const results = [
      view.set('bot', 'token', VALUE),
      view.isSet('bot', 'token'),
      view.unlocked,
      view.delete('bot', 'token'),
      view.set('bot', 'token', VALUE),
      view.deleteOwner('bot'),
    ]
    for (const result of results) {
      expect(result === undefined || typeof result === 'boolean' || typeof result === 'number').toBe(true)
    }
    expect(JSON.stringify(view)).not.toContain(VALUE)
  })
})

describe('master key', () => {
  it('parses 32 base64 bytes from CM_SECRETS_KEY', () => {
    const encoded = Buffer.alloc(32, 1).toString('base64')
    expect(loadConfig({ CM_SECRETS_KEY: encoded }).secretsKey).toBeInstanceOf(MasterKey)
    expect(loadConfig({}).secretsKey).toBeUndefined()
  })

  it('rejects the wrong length or encoding without echoing the input', () => {
    for (const bad of [Buffer.alloc(16).toString('base64'), Buffer.alloc(32).toString('hex'), 'not base64!']) {
      expect(() => MasterKey.parse(bad)).toThrow(/CM_SECRETS_KEY must be 32 bytes encoded as base64/)
      try {
        MasterKey.parse(bad)
      }
      catch (error) {
        expect((error as Error).message).not.toContain(bad)
      }
    }
  })

  it('never prints its bytes', () => {
    const encoded = Buffer.alloc(32, 9).toString('base64')
    const key = MasterKey.parse(encoded)
    for (const printed of [inspect(key), JSON.stringify({ key }), String(key), inspect(loadConfig({ CM_SECRETS_KEY: encoded }))]) {
      expect(printed).not.toContain(encoded)
      expect(printed).not.toContain(Buffer.alloc(32, 9).toString('hex'))
    }
  })
})

describe('platform secrets', () => {
  it('lives under the data directory', () => {
    const temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, { secretsKey: MasterKey.generate() })
    try {
      platform.secrets.set('bot', 'token', VALUE)
      expect(existsSync(join(temp.root, 'secrets', 'bot', 'token.json'))).toBe(true)
      expect(platform.secrets.get('bot', 'token')).toBe(VALUE)
    }
    finally {
      platform.close()
      temp.cleanup()
    }
  })

  it('is locked when started without a key', () => {
    const temp = createTempDataDir()
    const platform = startTestPlatform(temp.root)
    try {
      expect(platform.secrets.unlocked).toBe(false)
    }
    finally {
      platform.close()
      temp.cleanup()
    }
  })
})
