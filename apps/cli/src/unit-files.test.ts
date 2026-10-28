import { describe, expect, it } from 'vitest'
import { resolveSettings } from './settings'
import { parseEnvFile, renderEnvFile, renderUnit, servicePaths } from './unit-files'

describe('servicePaths', () => {
  it('puts the unit where the user manager reads it and the environment file beside other config', () => {
    expect(servicePaths('/home/jack')).toEqual({
      unitFile: '/home/jack/.config/systemd/user/candy-mountain.service',
      envDir: '/home/jack/.config/candy-mountain',
      envFile: '/home/jack/.config/candy-mountain/service.env',
    })
  })
})

describe('renderUnit', () => {
  it('runs the CLI in the foreground under an absolute node', () => {
    expect(renderUnit({
      nodePath: '/home/jack/.nvm/versions/node/v24.22.1/bin/node',
      cliEntry: '/home/jack/work/cm/apps/cli/dist/index.mjs',
      repoRoot: '/home/jack/work/cm',
      envFile: '/home/jack/.config/candy-mountain/service.env',
    })).toMatchInlineSnapshot(`
      "[Unit]
      Description=Candy Mountain daemon and web server

      [Service]
      Type=simple
      WorkingDirectory=/home/jack/work/cm
      EnvironmentFile=/home/jack/.config/candy-mountain/service.env
      ExecStart=/home/jack/.nvm/versions/node/v24.22.1/bin/node /home/jack/work/cm/apps/cli/dist/index.mjs run
      Restart=on-failure
      RestartSec=5
      TimeoutStopSec=45

      [Install]
      WantedBy=default.target
      "
    `)
  })

  it('escapes specifiers, variables and spaces in paths', () => {
    const unit = renderUnit({
      nodePath: '/opt/node 24/bin/node',
      cliEntry: '/srv/100%/$cm/apps/cli/dist/index.mjs',
      repoRoot: '/srv/100%/$cm',
      envFile: '/etc/cm.env',
    })
    expect(unit).toContain('WorkingDirectory=/srv/100%%/$cm\n')
    expect(unit).toContain('ExecStart="/opt/node 24/bin/node" /srv/100%%/$$cm/apps/cli/dist/index.mjs run\n')
  })

  it('refuses a path with a line break', () => {
    expect(() => renderUnit({ nodePath: '/bin/node', cliEntry: '/a\nExecStartPre=/bin/evil', repoRoot: '/a', envFile: '/e' })).toThrow(/line break/)
  })
})

describe('renderEnvFile', () => {
  const settings = resolveSettings('/repo', { CM_DATA_DIR: '/data/candy mountain', CM_DAEMON_PORT: '4711', CM_WEB_PORT: '4710' })

  it('writes the resolved settings and only a placeholder for the secrets key', () => {
    expect(renderEnvFile(settings, '/home/jack/.nvm/versions/node/v24.22.1/bin:/usr/bin')).toMatchInlineSnapshot(`
      "# Environment for candy-mountain.service. After editing: systemctl --user restart candy-mountain
      CM_DATA_DIR="/data/candy mountain"
      CM_DAEMON_HOST=127.0.0.1
      CM_DAEMON_PORT=4711
      CM_WEB_HOST=127.0.0.1
      CM_WEB_PORT=4710

      # The service does not read your shell profile; this is the PATH it runs tools such as git and bd with.
      PATH=/home/jack/.nvm/versions/node/v24.22.1/bin:/usr/bin

      # Secrets master key, 32 bytes base64 (openssl rand -base64 32). Keep a copy outside the data directory.
      # CM_SECRETS_KEY=
      "
    `)
  })

  it('reads back what it writes', () => {
    expect(parseEnvFile(renderEnvFile(settings, '/usr/bin'))).toEqual({
      CM_DATA_DIR: '/data/candy mountain',
      CM_DAEMON_HOST: '127.0.0.1',
      CM_DAEMON_PORT: '4711',
      CM_WEB_HOST: '127.0.0.1',
      CM_WEB_PORT: '4710',
      PATH: '/usr/bin',
    })
  })
})
