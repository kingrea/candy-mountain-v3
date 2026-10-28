import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from './main'
import { readPidFile } from './pid-file'
import { capture, FAKE_DAEMON, FAKE_WEB, freePort, writeEntry } from './test-fixtures'

describe('start, status and stop against stand-in processes', () => {
  let root: string
  let env: NodeJS.ProcessEnv

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cm-cli-'))
    writeEntry(root, 'apps/daemon/dist/index.mjs', FAKE_DAEMON)
    writeEntry(root, 'apps/web/.output/server/index.mjs', FAKE_WEB)
    env = {
      ...process.env,
      CM_DATA_DIR: join(root, 'data'),
      CM_DAEMON_PORT: String(await freePort()),
      CM_WEB_PORT: String(await freePort()),
    }
  })

  afterAll(async () => {
    await main(['stop'], { repoRoot: root, home: root, env, io: capture() })
    rmSync(root, { recursive: true, force: true })
  })

  it('starts both, refuses a second start, and stops both', async () => {
    const io = capture()
    expect(await main(['start', '--timeout', '10'], { repoRoot: root, home: root, env, io })).toBe(0)
    const daemon = readPidFile(join(root, 'data/run/daemon.pid'))
    expect(daemon?.port).toBe(Number(env.CM_DAEMON_PORT))

    const statusIo = capture()
    expect(await main(['status'], { repoRoot: root, home: root, env, io: statusIo })).toBe(0)
    expect(statusIo.lines.filter((line) => /running .* healthy/.test(line))).toHaveLength(2)

    const again = capture()
    expect(await main(['start'], { repoRoot: root, home: root, env, io: again })).toBe(1)
    expect(again.lines.join('\n')).toMatch(/already running: daemon \(pid \d+\), web \(pid \d+\)/)

    expect(await main(['stop'], { repoRoot: root, home: root, env, io: capture() })).toBe(0)
    expect(readPidFile(join(root, 'data/run/daemon.pid'))).toBeUndefined()
    expect(await main(['status'], { repoRoot: root, home: root, env, io: capture() })).toBe(3)
  })

  it('stops the daemon again when the web server fails to come up', async () => {
    writeEntry(root, 'apps/web/.output/server/index.mjs', `console.error('web exploded'); process.exit(1)`)
    const io = capture()
    expect(await main(['start', '--timeout', '10'], { repoRoot: root, home: root, env, io })).toBe(1)
    expect(io.lines.join('\n')).toMatch(/web did not come up: exited with code 1[\s\S]*web exploded/)
    expect(await main(['status'], { repoRoot: root, home: root, env, io: capture() })).toBe(3)
  })
})
