import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { addressUrl } from '@candy-mountain/config'
import { product } from './product'
import { isRunning, readPidFile, removePidFile } from './pid-file'
import { isHealthy, isPortInUse } from './probe'
import type { Settings } from './settings'
import { describeExit, launch, readLogTail, stopService, terminate, waitUntilHealthy, type Launched, type StopResult } from './supervisor'

export const EXIT = { ok: 0, failure: 1, usage: 2, notRunning: 3 } as const

export interface Io {
  out(line: string): void
  err(line: string): void
}

export async function start(settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const launched = await bringUp(settings, io, { detached: true, timeoutMs })
  if (!launched) return EXIT.failure
  io.out(`${product.name} is running at ${settings.services[1].url}`)
  return EXIT.ok
}

export async function stop(settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  let failed = false
  for (const service of [...settings.services].reverse()) {
    const result = await stopService(service, timeoutMs)
    failed ||= result === 'failed'
    io.out(`${service.name}: ${STOP_MESSAGES[result]}`)
  }
  return failed ? EXIT.failure : EXIT.ok
}

const STOP_MESSAGES: Record<StopResult, string> = {
  'not-running': 'not running',
  'stopped': 'stopped',
  'killed': 'did not stop in time, killed',
  'failed': 'could not be signalled',
}

export async function restart(settings: Settings, io: Io, timeouts: { stopMs: number, startMs: number }): Promise<number> {
  const stopped = await stop(settings, io, timeouts.stopMs)
  if (stopped !== EXIT.ok) return stopped
  return start(settings, io, timeouts.startMs)
}

export async function status(settings: Settings, io: Io): Promise<number> {
  let allRunning = true
  for (const service of settings.services) {
    const record = readPidFile(service.pidFile)
    if (!record || !isRunning(record)) {
      allRunning = false
      io.out(`${service.name.padEnd(7)} stopped  ${service.url}`)
      continue
    }
    const health = (await isHealthy(service.healthUrl)) ? 'healthy' : 'not responding'
    const owner = record.supervisor ? `  (foreground, supervisor pid ${record.supervisor})` : ''
    io.out(`${service.name.padEnd(7)} running  ${addressUrl(record)}  pid ${record.pid}  ${health}${owner}`)
  }
  io.out(`${'data'.padEnd(7)} ${settings.dataDir}`)
  io.out(`${'logs'.padEnd(7)} ${settings.logsDir}`)
  return allRunning ? EXIT.ok : EXIT.notRunning
}

export interface LogsOptions {
  which: 'daemon' | 'web' | 'all'
  lines: number
  follow: boolean
}

export function logs(settings: Settings, io: Io, options: LogsOptions): Promise<number> {
  const files = settings.services
    .filter((service) => options.which === 'all' || service.name === options.which)
    .map((service) => service.logFile)
    .filter((file) => existsSync(file))
  if (files.length === 0) {
    io.err(`no ${options.which === 'all' ? '' : `${options.which} `}log yet in ${settings.logsDir}`)
    return Promise.resolve(EXIT.failure)
  }
  const args = ['-n', String(options.lines), ...(options.follow ? ['-F'] : []), ...files]
  // Ctrl-C reaches tail directly; ignoring it here lets tail exit first and report its own status.
  const ignore = () => {}
  process.on('SIGINT', ignore)
  return new Promise((resolve) => {
    const tail = spawn('tail', args, { stdio: 'inherit' })
    tail.once('error', (error) => {
      io.err(`could not run tail: ${error.message}`)
      process.off('SIGINT', ignore)
      resolve(EXIT.failure)
    })
    tail.once('exit', (code, signal) => {
      process.off('SIGINT', ignore)
      resolve(signal ? EXIT.ok : (code ?? EXIT.failure))
    })
  })
}

/** Runs both processes as children until SIGTERM/SIGINT, so a service manager can supervise them directly. */
export async function run(settings: Settings, io: Io, timeouts: { stopMs: number, startMs: number }): Promise<number> {
  const launched = await bringUp(settings, io, { detached: false, timeoutMs: timeouts.startMs, supervisor: process.pid })
  if (!launched) return EXIT.failure
  io.out(`${product.name} is running at ${settings.services[1].url} (foreground, pid ${process.pid})`)

  return new Promise((resolve) => {
    let stopping = false
    const shutdown = async (code: number) => {
      if (stopping) return
      stopping = true
      for (const child of [...launched].reverse()) await terminate(child, timeouts.stopMs)
      resolve(code)
    }
    for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(name, () => void shutdown(EXIT.ok))
    for (const child of launched) {
      void child.exit.then((info) => {
        if (stopping) return
        io.err(`${child.service.name} exited with ${describeExit(info)}, stopping`)
        // A clean exit means someone stopped it on purpose, so a service manager should not restart it.
        void shutdown(info.code === 0 ? EXIT.ok : EXIT.failure)
      })
    }
  })
}

async function bringUp(
  settings: Settings,
  io: Io,
  options: { detached: boolean, timeoutMs: number, supervisor?: number },
): Promise<Launched[] | undefined> {
  const missing = settings.services.filter((service) => !existsSync(service.entry))
  if (missing.length > 0) {
    for (const service of missing) io.err(`${service.name} is not built (${service.entry} is missing); run pnpm build`)
    return undefined
  }

  const running = settings.services.flatMap((service) => {
    const record = readPidFile(service.pidFile)
    return record && isRunning(record) ? [`${service.name} (pid ${record.pid})`] : []
  })
  if (running.length > 0) {
    io.err(`already running: ${running.join(', ')}; use restart, or stop first`)
    return undefined
  }

  for (const service of settings.services) {
    removePidFile(service.pidFile)
    if (await isPortInUse(service.address)) {
      io.err(`${service.name} port is already in use at ${service.url} by a process this CLI did not start`)
      return undefined
    }
  }

  for (const dir of [settings.dataDir, settings.logsDir, settings.runDir]) mkdirSync(dir, { recursive: true, mode: 0o700 })

  const launched: Launched[] = []
  for (const service of settings.services) {
    io.out(`starting ${service.name} on ${service.url}`)
    const child = launch(service, options)
    launched.push(child)
    const failure = await waitUntilHealthy(child, options.timeoutMs)
    if (failure) {
      io.err(`${service.name} did not come up: ${failure}`)
      io.err(`last lines of ${service.logFile}:`)
      for (const line of readLogTail(service.logFile, 20)) io.err(`  ${line}`)
      for (const started of [...launched].reverse()) await terminate(started, 5000)
      return undefined
    }
  }
  return launched
}
