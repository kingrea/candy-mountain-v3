import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSecretsStore, MasterKey } from '../secrets'
import { createTempDataDir, type TempDataDir } from '../testing'
import { fixturePluginType } from './fixtures'
import { checkPluginHealth } from './health'
import { createPluginSecrets, pluginSecretOwner } from './secrets'

describe('plugin secrets accessor', () => {
  let temp: TempDataDir

  afterEach(() => temp?.cleanup())

  it('reads only its own instance and only declared secrets', () => {
    temp = createTempDataDir()
    const store = createSecretsStore(join(temp.root, 'secrets'), MasterKey.generate())
    store.set(pluginSecretOwner('a'), 'token', 'secret-a')
    store.set(pluginSecretOwner('b'), 'token', 'secret-b')
    store.set(pluginSecretOwner('a'), 'other', 'undeclared')
    const type = fixturePluginType('netlify')

    const secrets = createPluginSecrets(store, 'a', type)
    expect(secrets.get('token')).toBe('secret-a')
    expect(createPluginSecrets(store, 'c', type).get('token')).toBeUndefined()
    expect(() => secrets.get('other')).toThrow("Plugin type 'netlify' declares no secret 'other'.")
    expect(Object.keys(secrets)).toEqual(['get'])
  })
})

describe('checkPluginHealth', () => {
  const secretsOf = (values: Record<string, string>) => ({ get: (name: string) => values[name] })
  const config = { host: 'alpha', account: 'jack' }

  it('passes config and secrets to the check', async () => {
    const type = fixturePluginType('netlify')
    expect(await checkPluginHealth(type, { config, secrets: secretsOf({ token: 't' }) })).toEqual({ healthy: true })
    expect(await checkPluginHealth(type, { config, secrets: secretsOf({}) })).toEqual({ healthy: false, reason: 'Token is not set.' })
  })

  it('turns a thrown error into a reason with secret values redacted', async () => {
    const type = definePluginTypeThatThrows()
    expect(await checkPluginHealth(type, { config, secrets: secretsOf({ token: 'hunter2' }) })).toEqual({
      healthy: false,
      reason: '401 for token [redacted]',
    })
  })

  it('times out and aborts the check', async () => {
    let signal: AbortSignal | undefined
    const type = fixturePluginType('netlify', () => new Promise(() => {}))
    const wrapped = { ...type, healthCheck: (ctx: Parameters<typeof type.healthCheck>[0]) => {
      signal = ctx.signal
      return type.healthCheck(ctx)
    } }
    expect(await checkPluginHealth(wrapped, { config, secrets: secretsOf({}), timeoutMs: 20 })).toEqual({ healthy: false, reason: 'Health check timed out after 20 ms.' })
    expect(signal?.aborted).toBe(true)
  })

  it('treats a malformed result as unhealthy', async () => {
    const type = fixturePluginType('netlify', () => ({ healthy: false, reason: '' }))
    expect(await checkPluginHealth(type, { config, secrets: secretsOf({}) })).toEqual({ healthy: false, reason: 'Health check returned no result.' })
  })
})

function definePluginTypeThatThrows() {
  const type = fixturePluginType('netlify')
  return {
    ...type,
    healthCheck: ({ secrets }: Parameters<typeof type.healthCheck>[0]) => {
      throw new Error(`401 for token ${secrets.get('token')}`)
    },
  }
}
