import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import type { ExitInfo } from './events'

export const DEFAULT_KILL_TIMEOUT_MS = 5000
const STDERR_TAIL_LIMIT = 4000

export interface SpawnAgentProcessOptions {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  killTimeoutMs?: number
  onStderr?: (text: string) => void
}

export interface AgentProcess {
  readonly pid: number
  readonly stdin: Writable
  readonly stdout: Readable
  readonly exited: Promise<ExitInfo>
  readonly alive: boolean
  /** The last few KB of stderr, for error messages. */
  readonly stderrTail: string
  readonly spawnError: Error | undefined
  /** SIGTERM to the whole process group, SIGKILL after the timeout; resolves once the direct child is gone. */
  kill(): Promise<ExitInfo>
}

export class AgentSpawnError extends Error {
  constructor(command: string, cause: Error) {
    super(`Unable to start ${command}: ${cause.message}`)
    this.name = 'AgentSpawnError'
  }
}

type Child = ChildProcessByStdio<Writable, Readable, Readable>

function signalGroup(child: Child, signal: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, signal)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
    child.kill(signal)
  }
}

export function spawnAgentProcess(options: SpawnAgentProcessOptions): AgentProcess {
  // Its own process group, so one signal reaches the shim or adapter and the CLI it spawned.
  const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  const killTimeoutMs = options.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS
  let stderrTail = ''
  let exit: ExitInfo | undefined
  let spawnError: Error | undefined

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (text: string) => {
    stderrTail = (stderrTail + text).slice(-STDERR_TAIL_LIMIT)
    options.onStderr?.(text)
  })
  child.stdin.on('error', () => {})

  const exited = new Promise<ExitInfo>((resolve) => {
    child.once('error', (error) => {
      spawnError = error
      if (child.pid === undefined) resolve({ code: null, signal: null })
    })
    child.once('exit', (code, signal) => {
      exit = { code, signal }
      resolve(exit)
    })
  })
  void exited.then(() => {
    if (child.pid !== undefined) signalGroup(child, 'SIGKILL')
  })

  const alive = () => exit === undefined && child.pid !== undefined

  return {
    get pid() {
      if (child.pid === undefined) throw new AgentSpawnError(options.command, spawnError ?? new Error('no pid'))
      return child.pid
    },
    stdin: child.stdin,
    stdout: child.stdout,
    exited,
    get alive() {
      return alive()
    },
    get stderrTail() {
      return stderrTail
    },
    get spawnError() {
      return spawnError
    },
    async kill() {
      if (!alive()) return exited
      signalGroup(child, 'SIGTERM')
      const timer = setTimeout(() => {
        if (alive()) signalGroup(child, 'SIGKILL')
      }, killTimeoutMs)
      try {
        return await exited
      }
      finally {
        clearTimeout(timer)
      }
    },
  }
}
