import { spawn } from 'node:child_process'

export const GIT_TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export interface GitRunOptions {
  timeoutMs?: number
}

/** Runs `git <args>` in `cwd` without a shell and returns trimmed stdout; a non-zero exit throws GitError. */
export type GitRunner = (cwd: string, args: readonly string[], options?: GitRunOptions) => Promise<string>

export class GitError extends Error {
  readonly args: readonly string[]
  readonly exitCode: number | null
  readonly stderr: string
  readonly timedOut: boolean

  constructor(args: readonly string[], { exitCode, stderr, timedOut, message }: { exitCode: number | null, stderr: string, timedOut: boolean, message: string }) {
    super(message)
    this.name = 'GitError'
    this.args = args
    this.exitCode = exitCode
    this.stderr = stderr
    this.timedOut = timedOut
  }
}

export interface GitRunnerOptions {
  env?: NodeJS.ProcessEnv
}

export function createGitRunner({ env: baseEnv = process.env }: GitRunnerOptions = {}): GitRunner {
  return (cwd, args, { timeoutMs = GIT_TIMEOUT_MS } = {}) => new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...baseEnv, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    // Inherited from the daemon's shell these would point every command at one repository.
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[name]

    // Own process group, so a timeout also takes down helpers such as git-remote-https that would otherwise hold the pipes open.
    const detached = process.platform !== 'win32'
    const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached })
    const kill = () => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      }
      catch {
        child.kill('SIGKILL')
      }
    }
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    let timedOut = false
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT_BYTES) kill()
      else sink.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, timeoutMs)

    const command = `git ${args.join(' ')}`
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      const message = error.code === 'ENOENT' ? 'The git command is not installed or not on the daemon\'s PATH' : `${command}: ${error.message}`
      reject(new GitError(args, { exitCode: null, stderr: '', timedOut: false, message }))
    })
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      const err = Buffer.concat(stderr).toString('utf8').trim()
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8').trim())
      const message = timedOut
        ? `${command} did not finish within ${timeoutMs}ms`
        : err || `${command} exited with ${code === null ? `signal ${signal}` : `code ${code}`}`
      reject(new GitError(args, { exitCode: code, stderr: err, timedOut, message }))
    }
    child.on('close', finish)
    // After a kill the pipes may stay open in an orphan, so do not wait for 'close'.
    child.on('exit', (code, signal) => { if (timedOut) finish(code, signal) })
  })
}
