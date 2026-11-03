import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Distribution } from './distribution'
import { runCli, type CliHost } from './main'
import { readPidFile } from './pid-file'
import { capture, ENTRIES, FAKE_DAEMON, FAKE_WEB, freePort, testDistribution, writeEntry } from './test-fixtures'

describe('start, status and stop against stand-in processes', () => {
  let root: string
  let distribution: Distribution
  let env: NodeJS.ProcessEnv
  const cli = (argv: string[], host: CliHost = {}) => runCli(argv, distribution, { home: root, env, io: capture(), ...host })

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cm-cli-'))
    distribution = testDistribution(root)
    writeEntry(root, ENTRIES.daemon, FAKE_DAEMON)
    writeEntry(root, ENTRIES.web, FAKE_WEB)
    env = {
      ...process.env,
      CM_DATA_DIR: join(root, 'data'),
      CM_DAEMON_PORT: String(await freePort()),
      CM_WEB_PORT: String(await freePort()),
    }
  })

  afterAll(async () => {
    await cli(['stop'])
    rmSync(root, { recursive: true, force: true })
  })

  it('starts both, refuses a second start, and stops both', async () => {
    const io = capture()
    expect(await cli(['start', '--timeout', '10'], { io })).toBe(0)
    expect(io.lines.at(-1)).toBe(`Candy Mountain is running at http://127.0.0.1:${env.CM_WEB_PORT}`)
    const daemon = readPidFile(join(root, 'data/run/daemon.pid'))
    expect(daemon?.port).toBe(Number(env.CM_DAEMON_PORT))

    const statusIo = capture()
    expect(await cli(['status'], { io: statusIo })).toBe(0)
    expect(statusIo.lines.filter((line) => /running .* healthy/.test(line))).toHaveLength(2)

    const again = capture()
    expect(await cli(['start'], { io: again })).toBe(1)
    expect(again.lines.join('\n')).toMatch(/already running: daemon \(pid \d+\), web \(pid \d+\)/)

    expect(await cli(['stop'])).toBe(0)
    expect(readPidFile(join(root, 'data/run/daemon.pid'))).toBeUndefined()
    expect(await cli(['status'])).toBe(3)
  })

  it('stops the daemon again when the web server fails to come up', async () => {
    writeEntry(root, ENTRIES.web, `console.error('web exploded'); process.exit(1)`)
    const io = capture()
    expect(await cli(['start', '--timeout', '10'], { io })).toBe(1)
    expect(io.lines.join('\n')).toMatch(/web did not come up: exited with code 1[\s\S]*web exploded/)
    expect(await cli(['status'])).toBe(3)
  })
})
