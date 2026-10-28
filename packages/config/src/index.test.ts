import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addressUrl, resolveDaemonAddress, resolveDataDir, resolveWebAddress } from './index'

describe('resolveDaemonAddress', () => {
  it('defaults to loopback on 4310', () => {
    expect(resolveDaemonAddress({})).toEqual({ host: '127.0.0.1', port: 4310 })
  })

  it('reads overrides and rejects an invalid port', () => {
    expect(resolveDaemonAddress({ CM_DAEMON_HOST: '::1', CM_DAEMON_PORT: '5000' })).toEqual({ host: '::1', port: 5000 })
    expect(() => resolveDaemonAddress({ CM_DAEMON_PORT: '70000' })).toThrow(/CM_DAEMON_PORT/)
  })
})

describe('resolveWebAddress', () => {
  it('defaults to loopback on 4300', () => {
    expect(resolveWebAddress({})).toEqual({ host: '127.0.0.1', port: 4300 })
  })

  it('reads overrides and rejects an invalid port', () => {
    expect(resolveWebAddress({ CM_WEB_HOST: '0.0.0.0', CM_WEB_PORT: '4700' })).toEqual({ host: '0.0.0.0', port: 4700 })
    expect(() => resolveWebAddress({ CM_WEB_PORT: 'web' })).toThrow(/CM_WEB_PORT/)
  })
})

describe('resolveDataDir', () => {
  it('defaults under the XDG data home in the user home', () => {
    expect(resolveDataDir({})).toBe(join(homedir(), '.local', 'share', 'candy-mountain'))
  })

  it('honours an absolute XDG_DATA_HOME only', () => {
    expect(resolveDataDir({ XDG_DATA_HOME: '/xdg' })).toBe('/xdg/candy-mountain')
    expect(resolveDataDir({ XDG_DATA_HOME: 'relative' })).toBe(join(homedir(), '.local', 'share', 'candy-mountain'))
  })

  it('prefers CM_DATA_DIR, expanding ~ and resolving relative paths', () => {
    expect(resolveDataDir({ CM_DATA_DIR: '~/cm-data', XDG_DATA_HOME: '/xdg' })).toBe(join(homedir(), 'cm-data'))
    expect(resolveDataDir({ CM_DATA_DIR: 'cm-data' })).toBe(resolve('cm-data'))
  })
})

describe('addressUrl', () => {
  it('connects to loopback for wildcard binds and brackets IPv6', () => {
    expect(addressUrl({ host: '127.0.0.1', port: 4310 })).toBe('http://127.0.0.1:4310')
    expect(addressUrl({ host: '0.0.0.0', port: 1 })).toBe('http://127.0.0.1:1')
    expect(addressUrl({ host: '::', port: 1 })).toBe('http://[::1]:1')
    expect(addressUrl({ host: 'fe80::1', port: 1 })).toBe('http://[fe80::1]:1')
  })
})
