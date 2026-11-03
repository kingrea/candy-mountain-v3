import { describe, expect, it } from 'vitest'
import { resolveSettings } from './settings'
import { testDistribution } from './test-fixtures'

describe('resolveSettings', () => {
  it('derives pid files, logs and child environments from the shared configuration', () => {
    const settings = resolveSettings(testDistribution('/repo'), { CM_DATA_DIR: '/data', CM_DAEMON_PORT: '4711', CM_WEB_PORT: '4710', NITRO_PORT: '1' })
    const [daemon, web] = settings.services

    expect(settings).toMatchObject({
      names: { product: 'Candy Mountain', command: 'candy-mountain', unit: 'candy-mountain.service' },
      dataDir: '/data',
      logsDir: '/data/logs',
      runDir: '/data/run',
    })
    expect(daemon).toMatchObject({
      entry: '/repo/daemon/index.mjs',
      cwd: '/repo/daemon',
      healthUrl: 'http://127.0.0.1:4711/health',
      pidFile: '/data/run/daemon.pid',
      logFile: '/data/logs/daemon.log',
    })
    expect(daemon.env).toMatchObject({ CM_DATA_DIR: '/data', CM_DAEMON_HOST: '127.0.0.1', CM_DAEMON_PORT: '4711' })
    expect(web).toMatchObject({
      entry: '/repo/web/server/index.mjs',
      cwd: '/repo/web',
      healthUrl: 'http://127.0.0.1:4710/api/health',
      pidFile: '/data/run/web.pid',
      logFile: '/data/logs/web.log',
    })
    expect(web.env).toMatchObject({
      CM_DATA_DIR: '/data',
      HOST: '127.0.0.1',
      PORT: '4710',
      NITRO_HOST: '127.0.0.1',
      NITRO_PORT: '4710',
      NUXT_DAEMON_URL: 'http://127.0.0.1:4711',
    })
  })
})
