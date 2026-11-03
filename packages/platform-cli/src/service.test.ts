import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { start, stop } from './commands'
import type { Distribution } from './distribution'
import { runCli, type CliHost } from './main'
import { readPidFile } from './pid-file'
import { resolveSettings } from './settings'
import type { CommandResult, SystemdHost } from './systemd'
import { capture, ENTRIES, FAKE_DAEMON, FAKE_WEB, freePort, testDistribution, writeEntry } from './test-fixtures'

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' })

/** Stands in for systemctl and loginctl, starting the stand-in servers the way the unit's `run` would. */
function fakeSystemd(distribution: Distribution, env: NodeJS.ProcessEnv): SystemdHost & { calls: string[] } {
  const settings = resolveSettings(distribution, env)
  const quiet = capture()
  let active = false
  let enabled = false
  const up = async () => {
    active = (await start(settings, quiet, 10_000)) === 0
  }
  const down = async () => {
    await stop(settings, quiet, 5_000)
    active = false
  }
  const calls: string[] = []
  return {
    calls,
    booted: () => true,
    initName: () => 'systemd',
    wsl: () => false,
    run: async (command, args) => {
      const [scope, verb, ...rest] = args
      if (command === 'systemctl' && scope === '--version') return ok('systemd 255')
      if (command === 'systemctl' && verb === 'show-environment') return ok()
      calls.push(`${command} ${args.join(' ')}`)
      if (command === 'loginctl') return ok()
      switch (verb) {
        case 'is-active':
          return rest[0] === '--quiet' ? { ...ok(), code: active ? 0 : 3 } : { ...ok(active ? 'active\n' : 'inactive\n'), code: active ? 0 : 3 }
        case 'is-enabled':
          return ok(enabled ? 'enabled\n' : 'disabled\n')
        case 'is-failed':
          return { ...ok(), code: 1 }
        case 'enable':
          enabled = true
          if (rest.includes('--now') && !active) await up()
          return ok()
        case 'disable':
          enabled = false
          if (rest.includes('--now')) await down()
          return ok()
        case 'start':
          await up()
          return ok()
        case 'stop':
          await down()
          return ok()
        case 'restart':
          await down()
          await up()
          return ok()
        default:
          return ok()
      }
    },
  }
}

describe('install-service and uninstall-service', () => {
  let root: string
  let home: string
  let distribution: Distribution
  let env: NodeJS.ProcessEnv

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cm-service-'))
    home = join(root, 'home')
    distribution = testDistribution(root)
    writeEntry(root, ENTRIES.cli, '')
    writeEntry(root, ENTRIES.daemon, FAKE_DAEMON)
    writeEntry(root, ENTRIES.web, FAKE_WEB)
    env = {
      ...process.env,
      USER: 'jack',
      PATH: '/usr/local/bin:/usr/bin',
      CM_DATA_DIR: join(root, 'data'),
      CM_DAEMON_PORT: String(await freePort()),
      CM_WEB_PORT: String(await freePort()),
    }
  })

  afterAll(async () => {
    await stop(resolveSettings(distribution, env), capture(), 5_000)
    rmSync(root, { recursive: true, force: true })
  })

  it('explains a missing systemd and writes nothing', async () => {
    const io = capture()
    const systemd: SystemdHost = {
      run: async (command) => ({ code: command === 'systemctl' ? 0 : null, stdout: '', stderr: '' }),
      booted: () => false,
      initName: () => 'init',
      wsl: () => true,
    }
    expect(await runCli(['install-service'], distribution, { home, env, io, systemd })).toBe(1)
    expect(io.lines.join('\n')).toMatch(/not the init system[\s\S]*\/etc\/wsl.conf[\s\S]*systemd=true/)
    expect(existsSync(home)).toBe(false)
  })

  it('installs, routes the everyday commands through systemctl, and uninstalls', async () => {
    const systemd = fakeSystemd(distribution, env)
    const host: CliHost = { home, env, systemd }

    const install = capture()
    expect(await runCli(['install-service', '--timeout', '10'], distribution, { ...host, io: install })).toBe(0)
    expect(systemd.calls.filter((call) => !call.includes(' is-'))).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable --now candy-mountain.service',
      'loginctl enable-linger jack',
    ])
    expect(install.lines.at(-1)).toMatch(/is running at .* \(candy-mountain\.service\)/)

    const unit = readFileSync(join(home, '.config/systemd/user/candy-mountain.service'), 'utf8')
    expect(unit).toContain(`ExecStart=${process.execPath} ${join(root, ENTRIES.cli)} run\n`)
    expect(unit).toContain(`EnvironmentFile=${join(home, '.config/candy-mountain/service.env')}\n`)
    expect(unit).not.toMatch(/SECRETS/)
    const envFile = join(home, '.config/candy-mountain/service.env')
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(envFile, 'utf8')).toContain(`CM_DAEMON_PORT=${env.CM_DAEMON_PORT}\n`)

    const status = capture()
    // The environment file wins over the shell once the service is installed.
    expect(await runCli(['status'], distribution, { ...host, env: { ...env, CM_DAEMON_PORT: '1' }, io: status })).toBe(0)
    expect(status.lines.filter((line) => /running .* healthy/.test(line))).toHaveLength(2)
    expect(status.lines.at(-1)).toMatch(/^service +candy-mountain\.service +active, enabled$/)

    systemd.calls.length = 0
    expect(await runCli(['stop'], distribution, { ...host, io: capture() })).toBe(0)
    expect(await runCli(['start', '--timeout', '10'], distribution, { ...host, io: capture() })).toBe(0)
    expect(await runCli(['restart', '--timeout', '10'], distribution, { ...host, io: capture() })).toBe(0)
    expect(systemd.calls.filter((call) => /--user (start|stop|restart) /.test(call))).toEqual([
      'systemctl --user stop candy-mountain.service',
      'systemctl --user start candy-mountain.service',
      'systemctl --user restart candy-mountain.service',
    ])

    systemd.calls.length = 0
    expect(await runCli(['uninstall-service'], distribution, { ...host, io: capture() })).toBe(0)
    expect(systemd.calls).toEqual([
      'systemctl --user disable --now candy-mountain.service',
      'systemctl --user daemon-reload',
      'systemctl --user reset-failed candy-mountain.service',
    ])
    expect(existsSync(join(home, '.config/systemd/user/candy-mountain.service'))).toBe(false)
    expect(existsSync(envFile)).toBe(true)
    expect(await runCli(['status'], distribution, { ...host, io: capture() })).toBe(3)
  })
})

describe('another distribution', () => {
  let root: string
  let home: string
  let distribution: Distribution
  let env: NodeJS.ProcessEnv

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cm-other-'))
    home = join(root, 'home')
    distribution = {
      product: { name: 'Rock Candy' },
      cliEntry: join(root, 'bin/rock-candy.mjs'),
      root: join(root, 'opt/rock'),
      daemon: { entry: join(root, 'opt/rock/api/main.mjs'), cwd: join(root, 'opt/rock/api') },
      web: { entry: join(root, 'opt/rock/site/server.mjs'), cwd: join(root, 'opt/rock/site') },
      dataDir: () => join(root, 'rock-data'),
    }
    writeEntry(root, 'bin/rock-candy.mjs', '')
    writeEntry(root, 'opt/rock/api/main.mjs', FAKE_DAEMON)
    writeEntry(root, 'opt/rock/site/server.mjs', FAKE_WEB)
    env = {
      ...process.env,
      USER: 'jack',
      PATH: '/usr/bin',
      CM_DAEMON_PORT: String(await freePort()),
      CM_WEB_PORT: String(await freePort()),
    }
  })

  afterAll(async () => {
    await stop(resolveSettings(distribution, env), capture(), 5_000)
    rmSync(root, { recursive: true, force: true })
  })

  it('names its usage and missing-systemd advice after the product', async () => {
    const help = capture()
    expect(await runCli(['--help'], distribution, { home, env, io: help })).toBe(0)
    expect(help.lines[0]).toMatch(/^Usage: rock-candy <command>[\s\S]*~\/\.config\/rock-candy\/service\.env wins/)

    const io = capture()
    const systemd: SystemdHost = { run: async () => ({ code: null, stdout: '', stderr: '' }), booted: () => false, initName: () => 'init', wsl: () => false }
    expect(await runCli(['install-service'], distribution, { home, env, io, systemd })).toBe(1)
    expect(io.lines.at(-1)).toBe('Until then, `rock-candy start` runs Rock Candy in the background without a service.')
  })

  it('carries its name, paths and data directory into the unit, the environment file and the messages', async () => {
    const systemd = fakeSystemd(distribution, env)
    const host: CliHost = { home, env, systemd }

    const install = capture()
    expect(await runCli(['install-service', '--timeout', '10'], distribution, { ...host, io: install })).toBe(0)
    expect(systemd.calls).toContain('systemctl --user enable --now rock-candy.service')
    expect(install.lines.at(-1)).toBe(`Rock Candy is running at http://127.0.0.1:${env.CM_WEB_PORT} (rock-candy.service)`)
    expect(readPidFile(join(root, 'rock-data/run/daemon.pid'))?.entry).toBe(distribution.daemon.entry)

    const envFile = join(home, '.config/rock-candy/service.env')
    expect(readFileSync(join(home, '.config/systemd/user/rock-candy.service'), 'utf8')).toBe(`[Unit]
Description=Rock Candy daemon and web server

[Service]
Type=simple
WorkingDirectory=${join(root, 'opt/rock')}
EnvironmentFile=${envFile}
ExecStart=${process.execPath} ${distribution.cliEntry} run
Restart=on-failure
RestartSec=5
TimeoutStopSec=45

[Install]
WantedBy=default.target
`)
    const envSource = readFileSync(envFile, 'utf8')
    expect(envSource).toMatch(/^# Environment for rock-candy\.service\. After editing: systemctl --user restart rock-candy\n/)
    expect(envSource).toContain(`CM_DATA_DIR=${join(root, 'rock-data')}\n`)

    const status = capture()
    expect(await runCli(['status'], distribution, { ...host, io: status })).toBe(0)
    expect(status.lines).toContain(`data    ${join(root, 'rock-data')}`)
    expect(status.lines.at(-1)).toMatch(/^service +rock-candy\.service +active, enabled$/)

    systemd.calls.length = 0
    expect(await runCli(['uninstall-service'], distribution, { ...host, io: capture() })).toBe(0)
    expect(systemd.calls).toEqual([
      'systemctl --user disable --now rock-candy.service',
      'systemctl --user daemon-reload',
      'systemctl --user reset-failed rock-candy.service',
    ])
  })
})
