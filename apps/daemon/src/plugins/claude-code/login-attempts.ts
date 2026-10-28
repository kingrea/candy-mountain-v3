import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { CLAUDE_CODE_LOGIN_ATTEMPT_TTL_MS } from '@candy-mountain/shared'
import { CLAUDE_LOGIN_ARGS, claudeCliEnv, ensureConfigDir, readClaudeAuthStatus } from './cli'

/** How long the CLI may take to print its sign-in link before the attempt is failed. */
export const DEFAULT_PROMPT_TIMEOUT_MS = 30_000
/** How long the code exchange may take once the code has been written. */
export const DEFAULT_EXCHANGE_TIMEOUT_MS = 60_000
export const DEFAULT_KILL_GRACE_MS = 2_000

const MAX_PARSED_OUTPUT_BYTES = 64 * 1024
const MAX_CODE_LENGTH = 512

export type LoginAttemptStatus = 'starting' | 'waiting' | 'succeeded' | 'failed' | 'expired'

/** Fixed sentences; none quotes CLI output. */
export const LOGIN_FAILURES = {
  directory: 'The login directory could not be prepared.',
  spawn: 'The claude command could not be started; set its path in the plugin config if it is not on PATH.',
  noPrompt: 'The claude login command did not show a sign-in link in time.',
  exitedBeforeCode: 'The claude login command ended before a code was entered.',
  codeRejected: 'Claude did not accept the code.',
  exchangeTimeout: 'The code exchange did not finish in time.',
  notConfirmed: 'The login finished but claude does not report a login.',
  cancelled: 'The login was cancelled.',
  daemonStopped: 'The daemon stopped before the login finished.',
} as const
export type LoginFailure = (typeof LOGIN_FAILURES)[keyof typeof LOGIN_FAILURES]

export interface LoginAttemptView {
  id: string
  instanceId: string
  status: LoginAttemptStatus
  startedAt: string
  expiresAt: string
  endedAt?: string
  /** Present from `waiting` on. */
  url?: string
  codeSubmitted: boolean
  failure?: LoginFailure
}

export interface StartLoginAttemptOptions {
  instanceId: string
  configDir: string
  command?: string
}

export type SubmitCodeResult =
  | { outcome: 'accepted', attempt: LoginAttemptView }
  | { outcome: 'not_found' }
  | { outcome: 'not_waiting', attempt: LoginAttemptView }
  | { outcome: 'invalid_code', attempt: LoginAttemptView }

export interface LoginAttemptRegistryOptions {
  ttlMs?: number
  promptTimeoutMs?: number
  exchangeTimeoutMs?: number
  killGraceMs?: number
  statusTimeoutMs?: number
  env?: NodeJS.ProcessEnv
}

interface Attempt {
  view: LoginAttemptView
  configDir: string
  command?: string
  child?: ChildProcess
  output: string
  outputBytes: number
  expiryTimer?: NodeJS.Timeout
  promptTimer?: NodeJS.Timeout
  exchangeTimer?: NodeJS.Timeout
  prompted: Promise<void>
  markPrompted: () => void
  settled: Promise<void>
  markSettled: () => void
  ending: boolean
}

const isOpen = (view: LoginAttemptView) => view.status === 'starting' || view.status === 'waiting'
const snapshot = (view: LoginAttemptView): LoginAttemptView => ({ ...view })

/**
 * Drives `claude auth login` for one instance at a time: the CLI prints a sign-in link, then reads the
 * `<code>#<state>` the browser shows as one stdin line and exits 0 once it is exchanged. The code is
 * written to the process and kept nowhere; CLI output is read only to find the link and never surfaced.
 */
export class LoginAttemptRegistry {
  private readonly attempts = new Map<string, Attempt>()

  constructor(private readonly options: LoginAttemptRegistryOptions = {}) {}

  /** Resolves once the link is available (or the attempt already failed); returns the open attempt if one exists. */
  async start({ instanceId, configDir, command }: StartLoginAttemptOptions): Promise<LoginAttemptView> {
    const open = this.open(instanceId)
    if (open) {
      const existing = this.attempts.get(open.id)!
      await existing.prompted
      return snapshot(existing.view)
    }
    const attempt = this.create(instanceId, configDir, command)
    this.launch(attempt)
    await attempt.prompted
    return snapshot(attempt.view)
  }

  get(attemptId: string): LoginAttemptView | undefined {
    const attempt = this.attempts.get(attemptId)
    return attempt ? snapshot(attempt.view) : undefined
  }

  open(instanceId: string): LoginAttemptView | undefined {
    for (const attempt of this.attempts.values()) {
      if (attempt.view.instanceId === instanceId && isOpen(attempt.view)) return snapshot(attempt.view)
    }
    return undefined
  }

  /** Hands the code to the waiting process and resolves with the attempt's terminal state. */
  async submitCode(attemptId: string, code: string): Promise<SubmitCodeResult> {
    const attempt = this.attempts.get(attemptId)
    if (!attempt) return { outcome: 'not_found' }
    if (attempt.view.status !== 'waiting' || attempt.view.codeSubmitted || !attempt.child?.stdin) return { outcome: 'not_waiting', attempt: snapshot(attempt.view) }
    const trimmed = code.trim()
    if (!isPlausibleCode(trimmed)) return { outcome: 'invalid_code', attempt: snapshot(attempt.view) }

    attempt.view.codeSubmitted = true
    const stdin = attempt.child.stdin
    await new Promise<void>((resolve) => {
      // A write error means the process is already gone; its exit handler reports that.
      stdin.once('error', () => resolve())
      stdin.write(`${trimmed}\n`, () => resolve())
    })
    attempt.exchangeTimer = setTimeout(() => void this.end(attempt, 'failed', LOGIN_FAILURES.exchangeTimeout), this.options.exchangeTimeoutMs ?? DEFAULT_EXCHANGE_TIMEOUT_MS)
    attempt.exchangeTimer.unref()
    await attempt.settled
    return { outcome: 'accepted', attempt: snapshot(attempt.view) }
  }

  /** Ends the open attempt for an instance, if any. */
  async cancel(instanceId: string): Promise<void> {
    const open = this.open(instanceId)
    if (open) await this.end(this.attempts.get(open.id)!, 'failed', LOGIN_FAILURES.cancelled)
  }

  /** Kills every open attempt at once (daemon shutdown); the registry stays usable. */
  close(): void {
    for (const attempt of this.attempts.values()) {
      if (isOpen(attempt.view)) {
        attempt.ending = true
        signalGroup(attempt.child, 'SIGKILL')
        this.finish(attempt, 'failed', LOGIN_FAILURES.daemonStopped)
      }
      clearTimeout(attempt.expiryTimer)
    }
    this.attempts.clear()
  }

  private create(instanceId: string, configDir: string, command: string | undefined): Attempt {
    const now = Date.now()
    const ttl = this.options.ttlMs ?? CLAUDE_CODE_LOGIN_ATTEMPT_TTL_MS
    let markPrompted!: () => void
    let markSettled!: () => void
    const attempt: Attempt = {
      view: { id: randomUUID(), instanceId, status: 'starting', startedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl).toISOString(), codeSubmitted: false },
      configDir,
      command,
      output: '',
      outputBytes: 0,
      prompted: new Promise<void>(resolve => (markPrompted = resolve)),
      markPrompted,
      settled: new Promise<void>(resolve => (markSettled = resolve)),
      markSettled,
      ending: false,
    }
    this.attempts.set(attempt.view.id, attempt)
    // Finished attempts stay readable until their expiry so a late submit gets a status, not a 404.
    attempt.expiryTimer = setTimeout(() => {
      void this.end(attempt, 'expired').then(() => this.attempts.delete(attempt.view.id))
    }, ttl)
    attempt.expiryTimer.unref()
    return attempt
  }

  private launch(attempt: Attempt): void {
    try {
      ensureConfigDir(attempt.configDir)
    }
    catch {
      void this.end(attempt, 'failed', LOGIN_FAILURES.directory)
      return
    }
    let child: ChildProcess
    try {
      // Its own process group, so ending the attempt also ends a wrapper script's child.
      child = spawn(attempt.command ?? 'claude', CLAUDE_LOGIN_ARGS, {
        cwd: attempt.configDir,
        env: claudeCliEnv({ configDir: attempt.configDir, base: this.options.env }),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      })
    }
    catch {
      void this.end(attempt, 'failed', LOGIN_FAILURES.spawn)
      return
    }
    attempt.child = child
    child.stdin?.on('error', () => undefined)
    const onData = (chunk: Buffer) => this.consume(attempt, chunk)
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('error', () => void this.end(attempt, 'failed', LOGIN_FAILURES.spawn))
    child.once('close', code => void this.exited(attempt, code))

    attempt.promptTimer = setTimeout(() => {
      if (attempt.view.status === 'starting') void this.end(attempt, 'failed', LOGIN_FAILURES.noPrompt)
    }, this.options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS)
    attempt.promptTimer.unref()
  }

  private consume(attempt: Attempt, chunk: Buffer): void {
    if (attempt.view.status !== 'starting' || attempt.outputBytes > MAX_PARSED_OUTPUT_BYTES) return
    attempt.outputBytes += chunk.length
    attempt.output += stripAnsi(chunk.toString('utf8'))
    const url = parseLoginUrl(attempt.output)
    if (!url) return
    attempt.output = ''
    attempt.view.status = 'waiting'
    attempt.view.url = url
    clearTimeout(attempt.promptTimer)
    attempt.markPrompted()
  }

  private async exited(attempt: Attempt, code: number | null): Promise<void> {
    if (attempt.ending || !isOpen(attempt.view)) return
    attempt.ending = true
    if (code !== 0) {
      const failure = attempt.view.status === 'starting' ? LOGIN_FAILURES.noPrompt : attempt.view.codeSubmitted ? LOGIN_FAILURES.codeRejected : LOGIN_FAILURES.exitedBeforeCode
      this.finish(attempt, 'failed', failure)
      return
    }
    const status = await readClaudeAuthStatus({ command: attempt.command, configDir: attempt.configDir, timeoutMs: this.options.statusTimeoutMs })
    if (!isOpen(attempt.view)) return
    if ('loggedIn' in status && status.loggedIn) this.finish(attempt, 'succeeded')
    else this.finish(attempt, 'failed', LOGIN_FAILURES.notConfirmed)
  }

  private async end(attempt: Attempt, status: 'expired' | 'failed', failure?: LoginFailure): Promise<void> {
    if (!isOpen(attempt.view)) return
    attempt.ending = true
    const child = attempt.child
    if (child && child.exitCode === null && child.signalCode === null) await terminate(child, this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS)
    this.finish(attempt, status, failure)
  }

  private finish(attempt: Attempt, status: 'succeeded' | 'failed' | 'expired', failure?: LoginFailure): void {
    if (!isOpen(attempt.view)) return
    clearTimeout(attempt.promptTimer)
    clearTimeout(attempt.exchangeTimer)
    attempt.output = ''
    attempt.child?.stdin?.end()
    attempt.view.status = status
    attempt.view.endedAt = new Date().toISOString()
    if (failure) attempt.view.failure = failure
    attempt.markPrompted()
    attempt.markSettled()
  }
}

const URL_PATTERN = /https?:\/\/[^\s"'<>`)\]]+/g

/**
 * The CLI prints "If the browser didn't open, visit: <url>" and waits; when it prints more than one
 * link, the manual paste-back variant (`code=true`) is the one a person needs.
 */
export function parseLoginUrl(output: string): string | undefined {
  const urls = [...stripAnsi(output).matchAll(URL_PATTERN)].map(match => match[0]).filter(isHttpUrl)
  return urls.find(url => /[?&]code=true(?:&|$)/.test(url)) ?? urls[0]
}

function isHttpUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:'
  }
  catch {
    return false
  }
}

/**
 * The browser shows `<authorization code>#<state>`; the CLI answers anything without both halves with
 * "Invalid code" and keeps waiting, so such input is refused here and the attempt stays open.
 */
export function isPlausibleCode(code: string): boolean {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH || /[\p{Cc}\s]/u.test(code)) return false
  const [authorizationCode, state, ...rest] = code.split('#')
  return rest.length === 0 && Boolean(authorizationCode) && Boolean(state)
}

/* eslint-disable no-control-regex */
// OSC 8 hyperlinks: the target is kept as text so the URL survives stripping.
const OSC8_PATTERN = /\u001B\]8;[^;\u0007\u001B]*;([^\u0007\u001B]*)(?:\u0007|\u001B\\)/g
const ANSI_PATTERN = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g
/* eslint-enable no-control-regex */

export function stripAnsi(text: string): string {
  return text.replace(OSC8_PATTERN, (_, target: string) => (target ? ` ${target} ` : ' ')).replace(ANSI_PATTERN, '')
}

function terminate(child: ChildProcess, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    child.once('close', finish)
    child.once('exit', () => setTimeout(finish, 50).unref())
    signalGroup(child, 'SIGTERM')
    const timer = setTimeout(() => {
      signalGroup(child, 'SIGKILL')
      setTimeout(finish, 200).unref()
    }, graceMs)
    timer.unref()
  })
}

function signalGroup(child: ChildProcess | undefined, signal: NodeJS.Signals): void {
  if (child?.pid === undefined) return
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

/** One registry for the daemon; the plugin type's actions reach it as a module singleton and Platform.close ends it. */
export const claudeLoginAttempts = new LoginAttemptRegistry()
