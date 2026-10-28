import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { curateAgentEnv } from '../../acp/env'

export const CODEX_LOGIN_ARGS = ['login', '--device-auth'] as const
export const CODEX_STATUS_ARGS = ['login', 'status'] as const
export const CODEX_STATUS_TIMEOUT_MS = 10_000

const MAX_OUTPUT_BYTES = 64 * 1024

/** The same lookup the Codex ACP adapter makes: `CODEX_PATH` when configured, else `codex` on PATH. */
export function codexCommand(codexPath: string | undefined): string {
  return codexPath || 'codex'
}

export function codexEnv(home: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return curateAgentEnv({ base, extra: { CODEX_HOME: home, NO_BROWSER: '1', NO_COLOR: '1' } })
}

/** In its own process group so ending it also ends anything a wrapper script started. */
export function spawnCodex(command: string, args: readonly string[], home: string): ChildProcess {
  return spawn(command, [...args], { cwd: home, env: codexEnv(home), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
}

export function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  }
  catch {
    try {
      child.kill(signal)
    }
    catch {
      // Already gone.
    }
  }
}

const isRunning = (child: ChildProcess) => child.exitCode === null && child.signalCode === null

export function terminate(child: ChildProcess, graceMs: number): Promise<void> {
  if (!isRunning(child) || child.pid === undefined) return Promise.resolve()
  return new Promise((resolve) => {
    const kill = setTimeout(() => signalGroup(child, 'SIGKILL'), graceMs)
    kill.unref()
    child.once('close', () => {
      clearTimeout(kill)
      resolve()
    })
    signalGroup(child, 'SIGTERM')
  })
}

export type CodexLoginState =
  | { state: 'logged_in', method: string | null }
  | { state: 'logged_out' }
  | { state: 'unknown', reason: string }

export interface ReadCodexLoginOptions {
  home: string
  command: string
  signal?: AbortSignal
  timeoutMs?: number
}

/** Never starts the CLI for a home that does not exist, so a status probe cannot create one. */
export async function readCodexLoginState({ home, command, signal, timeoutMs = CODEX_STATUS_TIMEOUT_MS }: ReadCodexLoginOptions): Promise<CodexLoginState> {
  if (!existsSync(home)) return { state: 'logged_out' }
  const run = await runBounded(command, CODEX_STATUS_ARGS, home, timeoutMs, signal)
  if (run.kind === 'spawn_failed') return { state: 'unknown', reason: `The Codex CLI could not be started: ${run.message}` }
  if (run.kind === 'timed_out') return { state: 'unknown', reason: 'The Codex status command did not finish in time.' }
  if (run.kind === 'aborted') return { state: 'unknown', reason: 'The Codex status command was cancelled.' }
  return interpretCodexStatus(run.code, run.output)
}

/**
 * `codex login status` writes `Logged in using ChatGPT` (or `... an API key - <masked key>`) and exits 0,
 * or `Not logged in` and exits 1; only the method is kept so a masked key is never passed on.
 */
export function interpretCodexStatus(code: number | null, output: string): CodexLoginState {
  const lines = stripAnsi(output).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const loggedIn = lines.map(line => /^logged in using (.+)$/i.exec(line)).find(Boolean)
  if (code === 0 && loggedIn) {
    const how = loggedIn[1]!
    return { state: 'logged_in', method: /^chatgpt$/i.test(how) ? 'ChatGPT' : /^an api key/i.test(how) ? 'an API key' : null }
  }
  if (code !== 0 && lines.some(line => /^not logged in\b/i.test(line))) return { state: 'logged_out' }
  return { state: 'unknown', reason: 'The Codex status command\'s answer was not recognised.' }
}

export interface DeviceAuthPrompt {
  verificationUrl: string
  userCode: string
}

const URL_PATTERN = /https?:\/\/[^\s"'<>`)\]]+/
const USER_CODE = /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/

/**
 * `codex login --device-auth` prints the verification URL on the line after "Open this link…" and
 * the code on the first non-blank line after "Enter this one-time code…".
 */
export function parseDeviceAuthPrompt(rawOutput: string): DeviceAuthPrompt | undefined {
  const output = stripAnsi(rawOutput)
  const url = URL_PATTERN.exec(output)?.[0]
  if (!url) return undefined
  const lines = output.split(/\r?\n/).map(line => line.trim())
  const heading = lines.findIndex(line => /one-time code/i.test(line))
  if (heading === -1) return undefined
  const code = lines.slice(heading + 1).find(line => line.length > 0 && !URL_PATTERN.test(line))
  if (!code || !USER_CODE.test(code)) return undefined
  return { verificationUrl: url, userCode: code }
}

/* eslint-disable no-control-regex */
const OSC8_LINK = /\u001B\]8;[^;\u0007\u001B]*;([^\u0007\u001B]*)(?:\u0007|\u001B\\)/g
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g
/* eslint-enable no-control-regex */

// Terminal hyperlinks keep their target as text so a link-only URL still parses.
export function stripAnsi(text: string): string {
  return text.replace(OSC8_LINK, (_, target: string) => (target ? ` ${target} ` : ' ')).replace(ANSI, '')
}

type BoundedRun =
  | { kind: 'exited', code: number | null, output: string }
  | { kind: 'spawn_failed', message: string }
  | { kind: 'timed_out' }
  | { kind: 'aborted' }

function runBounded(command: string, args: readonly string[], home: string, timeoutMs: number, signal?: AbortSignal): Promise<BoundedRun> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ kind: 'aborted' })
    const child = spawnCodex(command, args, home)
    const chunks: Buffer[] = []
    let bytes = 0
    let settled = false
    const finish = (result: BoundedRun) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (result.kind !== 'exited') signalGroup(child, 'SIGKILL')
      resolve(result)
    }
    const onAbort = () => finish({ kind: 'aborted' })
    const timer = setTimeout(() => finish({ kind: 'timed_out' }), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    const collect = (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes <= MAX_OUTPUT_BYTES) chunks.push(chunk)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', error => finish({ kind: 'spawn_failed', message: error.message }))
    child.once('close', code => finish({ kind: 'exited', code, output: Buffer.concat(chunks).toString('utf8') }))
  })
}
