import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const hasBd = spawnSync('bd', ['--version'], { stdio: 'ignore' }).status === 0

export interface TempBeadsWorkspace {
  path: string
  /** Runs bd in the workspace and returns its parsed JSON output. */
  bd(...args: string[]): unknown
  /** Creates an issue and returns its id. */
  create(title: string, ...args: string[]): string
  cleanup(): void
}

export function createTempBeadsWorkspace(prefix = 'tmp'): TempBeadsWorkspace {
  const path = mkdtempSync(join(tmpdir(), 'candy-mountain-beads-'))
  const env: NodeJS.ProcessEnv = { ...process.env, BD_NON_INTERACTIVE: '1' }
  delete env.BEADS_DIR
  delete env.BEADS_DB
  const exec = (args: string[]) => execFileSync('bd', args, { cwd: path, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  exec(['init', '--non-interactive', '--prefix', prefix, '--skip-agents', '--quiet'])

  const bd = (...args: string[]) => JSON.parse(exec([...args, '--json'])) as unknown
  return {
    path,
    bd,
    create: (title, ...args) => (bd('create', '--title', title, ...args) as { id: string }).id,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  }
}
