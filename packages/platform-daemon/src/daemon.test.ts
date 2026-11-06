import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { loadDaemonConfig } from './daemon'
import { MasterKey } from './secrets'

const product = { name: 'Test Product' }

describe('loadDaemonConfig', () => {
  it('defaults to loopback on 4310', () => {
    expect(loadDaemonConfig(product, {})).toMatchObject({ host: '127.0.0.1', port: 4310 })
  })

  it('reads overrides from the environment', () => {
    expect(loadDaemonConfig(product, { CM_DAEMON_HOST: '0.0.0.0', CM_DAEMON_PORT: '5000', CM_DATA_DIR: '/srv/cm' }))
      .toEqual({ host: '0.0.0.0', port: 5000, dataDir: '/srv/cm', auth: { strategy: 'development' }, notifications: { webUrl: 'http://127.0.0.1:4300' } })
  })

  it('names the data directory after the product', () => {
    expect(loadDaemonConfig(product, { XDG_DATA_HOME: '/xdg' }).dataDir).toBe('/xdg/test-product')
  })

  it('parses the secrets master key from CM_SECRETS_KEY without echoing it', () => {
    const encoded = Buffer.alloc(32, 1).toString('base64')
    const config = loadDaemonConfig(product, { CM_SECRETS_KEY: encoded })
    expect(config.secretsKey).toBeInstanceOf(MasterKey)
    expect(inspect(config)).not.toContain(encoded)
    expect(loadDaemonConfig(product, {}).secretsKey).toBeUndefined()
  })

  it('rejects an invalid port', () => {
    expect(() => loadDaemonConfig(product, { CM_DAEMON_PORT: 'nope' })).toThrow(/CM_DAEMON_PORT/)
  })

  it('reads the web origin for notification links, dropping a trailing slash', () => {
    expect(loadDaemonConfig(product, { CM_WEB_URL: 'https://cm.example.com/' }).notifications).toEqual({ webUrl: 'https://cm.example.com' })
    expect(() => loadDaemonConfig(product, { CM_WEB_URL: 'cm.example.com' })).toThrow(/CM_WEB_URL/)
    expect(() => loadDaemonConfig(product, { CM_WEB_URL: 'ftp://x' })).toThrow(/CM_WEB_URL/)
  })
})
