import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { start, stop } from './commands'
import { main } from './main'
import { resolveSettings } from './settings'
import type { CommandResult, SystemdHost } from './systemd'
import { capture, FAKE_DAEMON, FAKE_WEB, freePort, writeEntry } from './test-fixtures'

const ok = (stdout = ''): CommandResult => ({ code: 0, stdout, stderr: '' })

/** Stands in for systemctl and loginctl, starting the stand-in servers the way the unit's `run` would. */
function fakeSystemd(repoRoot: string, env: NodeJS.ProcessEnv): SystemdHost & { calls: string[] } {
  const settings = resolveSettings(repoRoot, env)
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
  let env: NodeJS.ProcessEnv

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cm-service-'))
    home = join(root, 'home')
    writeEntry(root, 'apps/cli/dist/index.mjs', '')
    writeEntry(root, 'apps/daemon/dist/index.mjs', FAKE_DAEMON)
    writeEntry(root, 'apps/web/.output/server/index.mjs', FAKE_WEB)
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
    await stop(resolveSettings(root, env), capture(), 5_000)
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
    expect(await main(['install-service'], { repoRoot: root, home, env, io, systemd })).toBe(1)
    expect(io.lines.join('\n')).toMatch(/not the init system[\s\S]*\/etc\/wsl.conf[\s\S]*systemd=true/)
    expect(existsSync(home)).toBe(false)
  })

  it('installs, routes the everyday commands through systemctl, and uninstalls', async () => {
    const systemd = fakeSystemd(root, env)
    const context = { repoRoot: root, home, env, systemd }

    const install = capture()
    expect(await main(['install-service', '--timeout', '10'], { ...context, io: install })).toBe(0)
    expect(systemd.calls.filter((call) => !call.includes(' is-'))).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable --now candy-mountain.service',
      'loginctl enable-linger jack',
    ])
    expect(install.lines.at(-1)).toMatch(/is running at .* \(candy-mountain\.service\)/)

    const unit = readFileSync(join(home, '.config/systemd/user/candy-mountain.service'), 'utf8')
    expect(unit).toContain(`ExecStart=${process.execPath} ${join(root, 'apps/cli/dist/index.mjs')} run\n`)
    expect(unit).toContain(`EnvironmentFile=${join(home, '.config/candy-mountain/service.env')}\n`)
    expect(unit).not.toMatch(/SECRETS/)
    const envFile = join(home, '.config/candy-mountain/service.env')
    expect(statSync(envFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(envFile, 'utf8')).toContain(`CM_DAEMON_PORT=${env.CM_DAEMON_PORT}\n`)

    const status = capture()
    // The environment file wins over the shell once the service is installed.
    expect(await main(['status'], { ...context, env: { ...env, CM_DAEMON_PORT: '1' }, io: status })).toBe(0)
    expect(status.lines.filter((line) => /running .* healthy/.test(line))).toHaveLength(2)
    expect(status.lines.at(-1)).toMatch(/^service +candy-mountain\.service +active, enabled$/)

    systemd.calls.length = 0
    expect(await main(['stop'], { ...context, io: capture() })).toBe(0)
    expect(await main(['start', '--timeout', '10'], { ...context, io: capture() })).toBe(0)
    expect(await main(['restart', '--timeout', '10'], { ...context, io: capture() })).toBe(0)
    expect(systemd.calls.filter((call) => /--user (start|stop|restart) /.test(call))).toEqual([
      'systemctl --user stop candy-mountain.service',
      'systemctl --user start candy-mountain.service',
      'systemctl --user restart candy-mountain.service',
    ])

    systemd.calls.length = 0
    expect(await main(['uninstall-service'], { ...context, io: capture() })).toBe(0)
    expect(systemd.calls).toEqual([
      'systemctl --user disable --now candy-mountain.service',
      'systemctl --user daemon-reload',
      'systemctl --user reset-failed candy-mountain.service',
    ])
    expect(existsSync(join(home, '.config/systemd/user/candy-mountain.service'))).toBe(false)
    expect(existsSync(envFile)).toBe(true)
    expect(await main(['status'], { ...context, io: capture() })).toBe(3)
  })
})
