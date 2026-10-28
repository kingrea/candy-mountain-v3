import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { CodexLoginAttempt } from '@candy-mountain/shared'
import { CODEX_LOGIN_ARGS, parseDeviceAuthPrompt, readCodexLoginState, spawnCodex, stripAnsi, terminate } from './cli'
import { ensureCodexHome } from './home'

export const CODEX_LOGIN_TTL_MS = 10 * 60_000
export const CODEX_PROMPT_TIMEOUT_MS = 30_000
export const CODEX_KILL_GRACE_MS = 2_000

const MAX_PARSED_OUTPUT_BYTES = 64 * 1024

export const CODEX_LOGIN_FAILURES = {
  home: 'The Codex home could not be prepared.',
  noPrompt: 'The Codex CLI did not show a device code in time.',
  exitedBeforePrompt: 'The Codex CLI ended without showing a device code.',
  exited: 'The Codex CLI ended without completing the sign-in.',
  notConfirmed: 'The Codex CLI finished but does not report a login.',
  expired: 'The device login was not completed in time.',
  stopped: 'The daemon stopped before the login finished.',
} as const

export interface CodexLoginTarget {
  instanceId: string
  home: string
  command: string
  /** Awaited before the attempt reports success, so a client polling the attempt then reads fresh health. */
  onLoggedIn?: () => Promise<unknown>
}

export interface CodexLoginAttemptsOptions {
  ttlMs?: number
  promptTimeoutMs?: number
  killGraceMs?: number
  statusTimeoutMs?: number
}

interface Attempt {
  view: CodexLoginAttempt
  target: CodexLoginTarget
  child?: ChildProcess
  output: string
  outputBytes: number
  timers: NodeJS.Timeout[]
  /** Resolves once the device code is known or the attempt has ended. */
  prompted: Promise<void>
  markPrompted: () => void
}

const isOpen = (view: CodexLoginAttempt) => view.status === 'starting' || view.status === 'waiting'

/** One open attempt per instance, held in memory because the CLI keeps polling long after the request that started it. */
export class CodexLoginAttempts {
  private readonly attempts = new Map<string, Attempt>()

  constructor(private readonly options: CodexLoginAttemptsOptions = {}) {}

  /** Resolves once the verification URL and code are known, or with the failed attempt. An open attempt is returned as is. */
  async start(target: CodexLoginTarget): Promise<CodexLoginAttempt> {
    const open = this.attempts.get(target.instanceId)
    if (open && isOpen(open.view)) {
      await open.prompted
      return { ...open.view }
    }
    const attempt = this.create(target)
    this.launch(attempt)
    await attempt.prompted
    return { ...attempt.view }
  }

  get(instanceId: string): CodexLoginAttempt | null {
    const attempt = this.attempts.get(instanceId)
    return attempt ? { ...attempt.view } : null
  }

  /** Ends any open attempt for the instance and forgets it. */
  async cancel(instanceId: string): Promise<void> {
    const attempt = this.attempts.get(instanceId)
    if (!attempt) return
    await this.end(attempt, 'failed', CODEX_LOGIN_FAILURES.stopped)
    if (this.attempts.get(instanceId) === attempt) this.attempts.delete(instanceId)
  }

  async close(): Promise<void> {
    await Promise.all([...this.attempts.values()].map(attempt => this.end(attempt, 'failed', CODEX_LOGIN_FAILURES.stopped)))
  }

  private create(target: CodexLoginTarget): Attempt {
    const now = Date.now()
    let markPrompted!: () => void
    const prompted = new Promise<void>(resolve => (markPrompted = resolve))
    const attempt: Attempt = {
      view: {
        attemptId: randomUUID(),
        status: 'starting',
        verificationUrl: null,
        userCode: null,
        startedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + (this.options.ttlMs ?? CODEX_LOGIN_TTL_MS)).toISOString(),
        endedAt: null,
        failure: null,
      },
      target,
      output: '',
      outputBytes: 0,
      timers: [],
      prompted,
      markPrompted,
    }
    this.attempts.set(target.instanceId, attempt)
    this.after(attempt, this.options.ttlMs ?? CODEX_LOGIN_TTL_MS, () => this.end(attempt, 'expired', CODEX_LOGIN_FAILURES.expired))
    this.after(attempt, this.options.promptTimeoutMs ?? CODEX_PROMPT_TIMEOUT_MS, async () => {
      if (attempt.view.status === 'starting') await this.end(attempt, 'failed', CODEX_LOGIN_FAILURES.noPrompt)
    })
    return attempt
  }

  private after(attempt: Attempt, ms: number, run: () => Promise<void>) {
    const timer = setTimeout(() => void run(), ms)
    timer.unref()
    attempt.timers.push(timer)
  }

  private launch(attempt: Attempt): void {
    try {
      ensureCodexHome(attempt.target.home)
    }
    catch {
      this.finish(attempt, 'failed', CODEX_LOGIN_FAILURES.home)
      return
    }
    const child = spawnCodex(attempt.target.command, CODEX_LOGIN_ARGS, attempt.target.home)
    attempt.child = child
    child.stdout?.on('data', (chunk: Buffer) => this.consume(attempt, chunk))
    child.stderr?.on('data', (chunk: Buffer) => this.consume(attempt, chunk))
    child.once('error', error => this.finish(attempt, 'failed', `The Codex CLI could not be started: ${error.message}`))
    child.once('close', code => void this.exited(attempt, code))
  }

  private consume(attempt: Attempt, chunk: Buffer): void {
    if (attempt.view.status !== 'starting' || attempt.outputBytes > MAX_PARSED_OUTPUT_BYTES) return
    attempt.outputBytes += chunk.length
    attempt.output += stripAnsi(chunk.toString('utf8'))
    const prompt = parseDeviceAuthPrompt(attempt.output)
    if (!prompt) return
    attempt.output = ''
    attempt.view.status = 'waiting'
    attempt.view.verificationUrl = prompt.verificationUrl
    attempt.view.userCode = prompt.userCode
    attempt.markPrompted()
  }

  private async exited(attempt: Attempt, code: number | null): Promise<void> {
    if (!isOpen(attempt.view)) return
    if (attempt.view.status === 'starting') return this.finish(attempt, 'failed', CODEX_LOGIN_FAILURES.exitedBeforePrompt)
    if (code !== 0) return this.finish(attempt, 'failed', CODEX_LOGIN_FAILURES.exited)
    const { home, command } = attempt.target
    const state = await readCodexLoginState({ home, command, timeoutMs: this.options.statusTimeoutMs })
    if (state.state !== 'logged_in') return this.finish(attempt, 'failed', CODEX_LOGIN_FAILURES.notConfirmed)
    // The login itself worked; a failed health store must not turn it into a failure.
    await attempt.target.onLoggedIn?.().catch(() => {})
    this.finish(attempt, 'succeeded')
  }

  private async end(attempt: Attempt, status: 'failed' | 'expired', failure: string): Promise<void> {
    if (!isOpen(attempt.view)) return
    this.finish(attempt, status, failure)
    if (attempt.child) await terminate(attempt.child, this.options.killGraceMs ?? CODEX_KILL_GRACE_MS)
  }

  /** Only the first call for an attempt has any effect. */
  private finish(attempt: Attempt, status: 'succeeded' | 'failed' | 'expired', failure: string | null = null): void {
    if (!isOpen(attempt.view)) return
    for (const timer of attempt.timers) clearTimeout(timer)
    attempt.output = ''
    attempt.view = { ...attempt.view, status, verificationUrl: null, userCode: null, endedAt: new Date().toISOString(), failure }
    attempt.markPrompted()
  }
}

/** The daemon's registry; `Platform.close` ends its open attempts. */
export const codexLoginAttempts = new CodexLoginAttempts()
