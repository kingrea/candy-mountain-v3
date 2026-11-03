import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, closeSync, openSync, readSync, statSync } from 'node:fs'
import { isRunning, readPidFile, removePidFile, writePidFile } from './pid-file'
import { isHealthy, sleep } from './probe'
import type { Service } from './settings'

export interface ExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface Launched {
  service: Service
  child: ChildProcess
  exit: Promise<ExitInfo>
  exited?: ExitInfo
}

export type StopResult = 'not-running' | 'stopped' | 'killed' | 'failed'

export function launch(service: Service, options: { detached: boolean, supervisor?: number }): Launched {
  appendFileSync(service.logFile, `\n--- ${new Date().toISOString()} starting ${service.name} on ${service.url} ---\n`, { mode: 0o600 })
  const fd = openSync(service.logFile, 'a', 0o600)
  let child: ChildProcess
  try {
    child = spawn(process.execPath, [service.entry], {
      cwd: service.cwd,
      env: service.env,
      detached: options.detached,
      stdio: ['ignore', fd, fd],
    })
  }
  finally {
    closeSync(fd)
  }
  if (child.pid === undefined) throw new Error(`could not spawn ${service.name}`)

  writePidFile(service.pidFile, {
    pid: child.pid,
    entry: service.entry,
    host: service.address.host,
    port: service.address.port,
    startedAt: new Date().toISOString(),
    supervisor: options.supervisor,
  })
  if (options.detached) child.unref()

  const launched: Launched = {
    service,
    child,
    exit: new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        launched.exited = { code, signal }
        resolve(launched.exited)
      })
    }),
  }
  return launched
}

/** Resolves to undefined once healthy, or to the reason it never became healthy. */
export async function waitUntilHealthy(launched: Launched, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (launched.exited) return `exited with ${describeExit(launched.exited)}`
    if (await isHealthy(launched.service.healthUrl)) return undefined
    await sleep(250)
  }
  return `not healthy at ${launched.service.healthUrl} after ${Math.round(timeoutMs / 1000)}s`
}

export async function stopService(service: Service, timeoutMs: number): Promise<StopResult> {
  const record = readPidFile(service.pidFile)
  if (!record || !isRunning(record)) {
    removePidFile(service.pidFile)
    return 'not-running'
  }
  if (!signal(record.pid, 'SIGTERM')) return 'failed'
  let result: StopResult = 'stopped'
  if (!(await waitForExit(() => isRunning(record), timeoutMs))) {
    if (!signal(record.pid, 'SIGKILL')) return 'failed'
    await waitForExit(() => isRunning(record), 5000)
    result = 'killed'
  }
  removePidFile(service.pidFile)
  return result
}

export async function terminate(launched: Launched, timeoutMs: number): Promise<void> {
  if (!launched.exited) {
    launched.child.kill('SIGTERM')
    if (!(await waitForExit(() => !launched.exited, timeoutMs))) {
      launched.child.kill('SIGKILL')
      await launched.exit
    }
  }
  removePidFile(launched.service.pidFile)
}

export function describeExit({ code, signal }: ExitInfo): string {
  return signal ? `signal ${signal}` : `code ${code}`
}

export function readLogTail(file: string, maxLines: number): string[] {
  try {
    const size = statSync(file).size
    const length = Math.min(size, 16 * 1024)
    const buffer = Buffer.alloc(length)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buffer, 0, length, size - length)
    }
    finally {
      closeSync(fd)
    }
    return buffer.toString('utf8').trimEnd().split('\n').slice(-maxLines)
  }
  catch {
    return []
  }
}

function signal(pid: number, name: NodeJS.Signals): boolean {
  try {
    process.kill(pid, name)
    return true
  }
  catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

async function waitForExit(alive: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (alive()) {
    if (Date.now() >= deadline) return false
    await sleep(100)
  }
  return true
}
