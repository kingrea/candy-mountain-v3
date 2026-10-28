import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DataPaths } from '../../data-dir'

export const CLAUDE_COMMAND = 'claude'
export const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR'
export const CLAUDE_OAUTH_TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN'
export const CLAUDE_STATUS_ARGS = ['auth', 'status', '--json'] as const
export const CLAUDE_LOGIN_ARGS = ['auth', 'login', '--claudeai'] as const

export const DEFAULT_CLI_TIMEOUT_MS = 10_000
const MAX_OUTPUT_BYTES = 64 * 1024

/** The only inherited variables the CLI receives; everything else (API keys, gateways) stays with the daemon. */
const INHERITED_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR'] as const

export interface ClaudeCliEnvOptions {
  configDir: string
  oauthToken?: string
  base?: NodeJS.ProcessEnv
}

export function claudeCliEnv({ configDir, oauthToken, base = process.env }: ClaudeCliEnvOptions): Record<string, string> {
  const env: Record<string, string> = { NO_COLOR: '1', FORCE_COLOR: '0' }
  for (const name of INHERITED_ENV) {
    const value = base[name]
    if (value) env[name] = value
  }
  env[CLAUDE_CONFIG_DIR_ENV] = configDir
  if (oauthToken) env[CLAUDE_OAUTH_TOKEN_ENV] = oauthToken
  return env
}

/** One private config directory per instance, so each project can hold its own Claude login. */
export const claudeConfigDir = (paths: Pick<DataPaths, 'agentHomes'>, instanceId: string) => join(paths.agentHomes, 'claude-code', instanceId)

export function configDirExists(configDir: string): boolean {
  try {
    return lstatSync(configDir).isDirectory()
  }
  catch {
    return false
  }
}

export function ensureConfigDir(configDir: string): string {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  // A symlinked home could point the CLI at another account's login.
  if (lstatSync(configDir).isSymbolicLink()) throw new Error('The Claude config directory must not be a symbolic link')
  chmodSync(configDir, 0o700)
  return configDir
}

export function removeConfigDir(configDir: string): boolean {
  if (!configDirExists(configDir)) return false
  rmSync(configDir, { recursive: true, force: true })
  return true
}

export type ClaudeRun =
  | { kind: 'exited', code: number | null, stdout: string, stderr: string }
  | { kind: 'spawn_failed' }
  | { kind: 'timed_out' }
  | { kind: 'overflow' }

export interface RunClaudeOptions {
  command?: string
  cwd: string
  env: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

/** Runs one short CLI command to completion with bounded time and output. */
export function runClaude(args: readonly string[], { command = CLAUDE_COMMAND, cwd, env, timeoutMs = DEFAULT_CLI_TIMEOUT_MS, signal }: RunClaudeOptions): Promise<ClaudeRun> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    }
    catch {
      resolve({ kind: 'spawn_failed' })
      return
    }
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let done = false
    const finish = (run: ClaudeRun) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(run)
    }
    const end = (run: ClaudeRun) => {
      finish(run)
      child.kill('SIGKILL')
    }
    const onAbort = () => end({ kind: 'timed_out' })
    const timer = setTimeout(() => end({ kind: 'timed_out' }), timeoutMs)
    timer.unref()
    signal?.addEventListener('abort', onAbort, { once: true })
    const collect = (sink: 'stdout' | 'stderr') => (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_OUTPUT_BYTES) end({ kind: 'overflow' })
      else if (sink === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }
    child.stdout?.on('data', collect('stdout'))
    child.stderr?.on('data', collect('stderr'))
    child.once('error', () => finish({ kind: 'spawn_failed' }))
    child.once('close', code => finish({ kind: 'exited', code, stdout, stderr }))
  })
}

export interface ClaudeAuthStatus {
  loggedIn: boolean
  /** Whitelisted, pattern-checked account fields from `claude auth status --json`; never raw output. */
  email?: string
  subscriptionType?: string
  authMethod?: string
}

export const STATUS_UNKNOWN_REASONS = {
  cliMissing: 'The claude command could not be started; set its path in the plugin config if it is not on PATH.',
  timedOut: 'The claude status command did not finish in time.',
  unrecognised: 'The claude status command gave an answer that was not recognised.',
} as const

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9 ._:@+-]{0,63}$/
const SAFE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/
const safe = (value: unknown, pattern: RegExp) => (typeof value === 'string' && pattern.test(value) ? value : undefined)

/** `claude auth status --json` prints `{ loggedIn, authMethod, email, subscriptionType, ... }`; only those four are read. */
export function interpretClaudeStatus(run: ClaudeRun): ClaudeAuthStatus | { unknown: string } {
  if (run.kind === 'spawn_failed') return { unknown: STATUS_UNKNOWN_REASONS.cliMissing }
  if (run.kind === 'timed_out') return { unknown: STATUS_UNKNOWN_REASONS.timedOut }
  if (run.kind === 'overflow') return { unknown: STATUS_UNKNOWN_REASONS.unrecognised }
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  }
  catch {
    return { unknown: STATUS_UNKNOWN_REASONS.unrecognised }
  }
  if (!parsed || typeof parsed !== 'object') return { unknown: STATUS_UNKNOWN_REASONS.unrecognised }
  const record = parsed as Record<string, unknown>
  if (record.loggedIn === false) return { loggedIn: false }
  if (record.loggedIn !== true || run.code !== 0) return { unknown: STATUS_UNKNOWN_REASONS.unrecognised }
  const status: ClaudeAuthStatus = { loggedIn: true }
  const email = safe(record.email, SAFE_EMAIL)
  const subscriptionType = safe(record.subscriptionType, SAFE_TOKEN)
  const authMethod = safe(record.authMethod, SAFE_TOKEN)
  if (email) status.email = email
  if (subscriptionType) status.subscriptionType = subscriptionType
  if (authMethod) status.authMethod = authMethod
  return status
}

export interface ReadClaudeAuthStatusOptions {
  command?: string
  configDir: string
  oauthToken?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export async function readClaudeAuthStatus({ command, configDir, oauthToken, timeoutMs, signal }: ReadClaudeAuthStatusOptions): Promise<ClaudeAuthStatus | { unknown: string }> {
  const run = await runClaude(CLAUDE_STATUS_ARGS, { command, cwd: configDir, env: claudeCliEnv({ configDir, oauthToken }), timeoutMs, signal })
  return interpretClaudeStatus(run)
}
