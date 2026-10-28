import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig, resolveDataDir } from './config'

describe('loadConfig', () => {
  it('defaults to loopback on 4310', () => {
    expect(loadConfig({})).toMatchObject({ host: '127.0.0.1', port: 4310 })
  })

  it('reads overrides from the environment', () => {
    expect(loadConfig({ CM_DAEMON_HOST: '0.0.0.0', CM_DAEMON_PORT: '5000', CM_DATA_DIR: '/srv/cm' }))
      .toEqual({ host: '0.0.0.0', port: 5000, dataDir: '/srv/cm', auth: { strategy: 'development' }, sessions: { idleTimeoutMs: 900_000, maxLive: 4 }, decisions: { timeoutMs: 300_000 }, worktrees: { maxPerProject: 4, idleTimeoutMs: 7_200_000, reclaimIntervalMs: 600_000 }, notifications: { webUrl: 'http://127.0.0.1:4300' }, uptime: { historyMax: 500, historyMaxAgeMs: 30 * 86_400_000 } })
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ CM_DAEMON_PORT: 'nope' })).toThrow(/CM_DAEMON_PORT/)
  })

  it('reads the web origin for notification links, dropping a trailing slash', () => {
    expect(loadConfig({ CM_WEB_URL: 'https://cm.example.com/' }).notifications).toEqual({ webUrl: 'https://cm.example.com' })
    expect(() => loadConfig({ CM_WEB_URL: 'cm.example.com' })).toThrow(/CM_WEB_URL/)
    expect(() => loadConfig({ CM_WEB_URL: 'ftp://x' })).toThrow(/CM_WEB_URL/)
  })

  it('reads the uptime history bounds', () => {
    expect(loadConfig({ CM_UPTIME_HISTORY_MAX: '20', CM_UPTIME_HISTORY_MAX_AGE: '12h' }).uptime).toEqual({ historyMax: 20, historyMaxAgeMs: 43_200_000 })
    expect(() => loadConfig({ CM_UPTIME_HISTORY_MAX: '0' })).toThrow(/CM_UPTIME_HISTORY_MAX/)
    expect(() => loadConfig({ CM_UPTIME_HISTORY_MAX_AGE: '30' })).toThrow(/CM_UPTIME_HISTORY_MAX_AGE/)
  })
})

describe('resolveDataDir', () => {
  it('defaults under the XDG data home in the user home', () => {
    expect(resolveDataDir({})).toBe(join(homedir(), '.local', 'share', 'candy-mountain'))
  })

  it('honours XDG_DATA_HOME', () => {
    expect(resolveDataDir({ XDG_DATA_HOME: '/xdg' })).toBe('/xdg/candy-mountain')
  })

  it('prefers CM_DATA_DIR and expands ~', () => {
    expect(resolveDataDir({ CM_DATA_DIR: '~/cm-data', XDG_DATA_HOME: '/xdg' })).toBe(join(homedir(), 'cm-data'))
  })
})
