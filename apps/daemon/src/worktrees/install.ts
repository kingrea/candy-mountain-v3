import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_ENV_ALLOWLIST } from '../acp/env'
import type { WorktreeDependenciesStatus } from '../db/schema/worktree-leases'

export type PackageManager = 'pnpm' | 'npm' | 'yarn'

export const DEPENDENCY_INSTALL_TIMEOUT_MS = 5 * 60_000
export const DEPENDENCY_OUTPUT_TAIL_BYTES = 4096
const MAX_BUFFERED_BYTES = 64 * 1024

const LOCKFILES: Record<PackageManager, readonly string[]> = {
  pnpm: ['pnpm-lock.yaml'],
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
  yarn: ['yarn.lock'],
}
// A stray package-lock.json from an accidental `npm install` is the usual reason for two lockfiles.
const LOCKFILE_PRECEDENCE: readonly PackageManager[] = ['pnpm', 'yarn', 'npm']

const INSTALL_ENV_ALLOWLIST = [
  ...AGENT_ENV_ALLOWLIST,
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'PNPM_HOME',
  'COREPACK_HOME',
  'NVM_DIR',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const

const INSTALL_ENV_FIXED = {
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  NO_UPDATE_NOTIFIER: '1',
  npm_config_update_notifier: 'false',
  NO_COLOR: '1',
  FORCE_COLOR: '0',
}

export interface DependencyInstallPlan {
  packageManager: PackageManager
  lockfile: string
  /** Tried in order until one succeeds; each is `[binary, ...args]`. */
  commands: string[][]
}

export type DependencyDetection = { kind: 'install', plan: DependencyInstallPlan } | { kind: 'skip', reason: string }

export interface DependencyInstallResult {
  status: WorktreeDependenciesStatus
  packageManager: PackageManager | null
  /** Tail of the install output, or why the install was skipped. */
  output: string
}

export interface DependencyInstallOptions {
  timeoutMs?: number
  /** The environment the curated install environment is picked from. */
  env?: NodeJS.ProcessEnv
}

export type DependencyInstaller = (dir: string, options?: DependencyInstallOptions) => Promise<DependencyInstallResult>

export interface WorktreeDependencies {
  status: WorktreeDependenciesStatus
  output: string | null
  checkedAt: string
}

/** Maps a lease's install outcome to what the bot's surface instructions report. */
export function dependencyInstallState(dependencies: WorktreeDependencies | null): boolean | 'failed' {
  if (dependencies?.status === 'failed') return 'failed'
  return dependencies?.status === 'installed'
}

function declaredPackageManager(manifest: unknown): PackageManager | null {
  const field = typeof manifest === 'object' && manifest !== null ? (manifest as Record<string, unknown>).packageManager : undefined
  if (typeof field !== 'string') return null
  const name = field.split('@')[0]
  return name === 'pnpm' || name === 'npm' || name === 'yarn' ? name : null
}

function isYarnBerryLockfile(path: string): boolean {
  return /^__metadata:/m.test(readFileSync(path, 'utf8'))
}

export function installCommands(packageManager: PackageManager, { yarnBerry = false }: { yarnBerry?: boolean } = {}): string[][] {
  switch (packageManager) {
    case 'pnpm':
      return [
        ['pnpm', 'install', '--offline', '--frozen-lockfile'],
        ['pnpm', 'install', '--frozen-lockfile', '--prefer-offline'],
      ]
    case 'npm':
      return [['npm', 'ci', '--prefer-offline', '--no-audit', '--no-fund']]
    case 'yarn':
      return yarnBerry
        ? [['yarn', 'install', '--immutable']]
        : [['yarn', 'install', '--frozen-lockfile', '--prefer-offline', '--non-interactive']]
  }
}

export function detectPackageManager(dir: string): DependencyDetection {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return { kind: 'skip', reason: 'No package.json in the worktree; nothing to install.' }
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  }
  catch {
    manifest = null
  }

  const found = new Map<PackageManager, string>()
  for (const manager of LOCKFILE_PRECEDENCE) {
    const lockfile = LOCKFILES[manager].find(name => existsSync(join(dir, name)))
    if (lockfile) found.set(manager, lockfile)
  }
  if (found.size === 0) {
    return { kind: 'skip', reason: 'package.json has no pnpm-lock.yaml, package-lock.json or yarn.lock; not installing without a lockfile.' }
  }
  const declared = declaredPackageManager(manifest)
  const packageManager = declared && found.has(declared) ? declared : [...found.keys()][0]!
  const lockfile = found.get(packageManager)!
  const yarnBerry = packageManager === 'yarn' && isYarnBerryLockfile(join(dir, lockfile))
  return { kind: 'install', plan: { packageManager, lockfile, commands: installCommands(packageManager, { yarnBerry }) } }
}

export function installEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of INSTALL_ENV_ALLOWLIST) {
    const value = base[name]
    if (value) env[name] = value
  }
  return { ...env, ...INSTALL_ENV_FIXED }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g

function tail(text: string, bytes: number): string {
  const clean = text.replace(ANSI, '').trim()
  const buffer = Buffer.from(clean, 'utf8')
  if (buffer.length <= bytes) return clean
  return `…${buffer.subarray(buffer.length - bytes).toString('utf8').replace(/^�+/, '')}`
}

interface CommandOutcome {
  ok: boolean
  log: string
  /** A timeout or a missing binary, either of which the next command would hit too. */
  stop: boolean
}

function runCommand(dir: string, [binary, ...args]: string[], env: Record<string, string>, timeoutMs: number): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const header = `$ ${[binary, ...args].join(' ')}\n`
    // Own process group, so a timeout also kills lifecycle scripts the package manager started.
    const detached = process.platform !== 'win32'
    const child = spawn(binary!, args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached })
    let output = ''
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (output.length > MAX_BUFFERED_BYTES) output = output.slice(-MAX_BUFFERED_BYTES)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      }
      catch {
        child.kill('SIGKILL')
      }
    }, timeoutMs)
    const settle = (outcome: CommandOutcome) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      resolve(outcome)
    }
    child.on('error', (error: NodeJS.ErrnoException) => {
      const reason = error.code === 'ENOENT' ? `${binary} is not installed or not on the daemon's PATH` : error.message
      settle({ ok: false, log: `${header}${output}\n${reason}\n`, stop: error.code === 'ENOENT' })
    })
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      const status = timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : code === 0 ? null : code === null ? `killed by ${signal}` : `exited with code ${code}`
      settle({ ok: code === 0 && !timedOut, log: `${header}${output}${status ? `\n${status}\n` : ''}`, stop: timedOut })
    }
    child.on('close', finish)
    // After a kill the pipes may stay open in an orphan, so do not wait for 'close'.
    child.on('exit', (code, signal) => { if (timedOut) finish(code, signal) })
  })
}

/** Installs the dependencies of the checkout at `dir` with the package manager its lockfile names; never throws. */
export const installWorktreeDependencies: DependencyInstaller = async (dir, { timeoutMs = DEPENDENCY_INSTALL_TIMEOUT_MS, env } = {}) => {
  let detection: DependencyDetection
  try {
    detection = detectPackageManager(dir)
  }
  catch (error) {
    return { status: 'failed', packageManager: null, output: `Could not read the worktree's package manifest: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (detection.kind === 'skip') return { status: 'skipped', packageManager: null, output: detection.reason }

  const { packageManager, commands } = detection.plan
  const childEnv = installEnv(env)
  const deadline = Date.now() + timeoutMs
  let log = ''
  for (const command of commands) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    const outcome = await runCommand(dir, command, childEnv, remaining)
    log += outcome.log
    if (outcome.ok) return { status: 'installed', packageManager, output: tail(log, DEPENDENCY_OUTPUT_TAIL_BYTES) }
    if (outcome.stop) break
  }
  return { status: 'failed', packageManager, output: tail(log, DEPENDENCY_OUTPUT_TAIL_BYTES) }
}
