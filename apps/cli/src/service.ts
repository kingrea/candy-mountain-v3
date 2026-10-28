import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PRODUCT_NAME } from '@candy-mountain/shared'
import { EXIT, stop, type Io } from './commands'
import { isRunning, readPidFile } from './pid-file'
import { isHealthy, sleep } from './probe'
import type { Settings } from './settings'
import { readLogTail } from './supervisor'
import { checkSystemd, firstLine, systemctl, type SystemdHost } from './systemd'
import { ENV_KEYS, parseEnvFile, renderEnvFile, renderUnit, servicePaths, UNIT_NAME } from './unit-files'

export interface ServiceContext {
  repoRoot: string
  home: string
  nodePath: string
  user: string
  /** The PATH written into a new environment file. */
  path: string | undefined
  systemd: SystemdHost
}

export function isServiceInstalled(home: string): boolean {
  return existsSync(servicePaths(home).unitFile)
}

/** The CM_* values from the service's environment file, which win over the shell so the CLI looks where the service runs. */
export function serviceEnvOverrides(home: string): NodeJS.ProcessEnv {
  let source: string
  try {
    source = readFileSync(servicePaths(home).envFile, 'utf8')
  }
  catch {
    return {}
  }
  const parsed = parseEnvFile(source)
  return Object.fromEntries(ENV_KEYS.flatMap((key) => (parsed[key] ? [[key, parsed[key]]] : [])))
}

export async function installService(ctx: ServiceContext, settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const problem = await checkSystemd(ctx.systemd)
  if (problem) return report(io, problem)

  const paths = servicePaths(ctx.home)
  const cliEntry = join(ctx.repoRoot, 'apps', 'cli', 'dist', 'index.mjs')
  const missing = [cliEntry, ...settings.services.map((service) => service.entry)].filter((file) => !existsSync(file))
  if (missing.length > 0) return report(io, [...missing.map((file) => `not built: ${file} is missing`), 'run pnpm build, then install-service again'])

  const detached = settings.services.some((service) => {
    const record = readPidFile(service.pidFile)
    return record && isRunning(record) && !record.supervisor
  })
  if (detached) {
    io.out('stopping the copy started with `candy-mountain start` so the service can take over')
    if (await stop(settings, io, 15_000) !== EXIT.ok) return EXIT.failure
  }

  if (existsSync(paths.envFile)) {
    io.out(`kept ${paths.envFile}`)
  }
  else {
    mkdirSync(paths.envDir, { recursive: true, mode: 0o700 })
    writeFileSync(paths.envFile, renderEnvFile(settings, ctx.path), { mode: 0o600, flag: 'wx' })
    io.out(`wrote ${paths.envFile} (set CM_SECRETS_KEY there to unlock the secrets store)`)
  }

  const unit = renderUnit({ nodePath: ctx.nodePath, cliEntry, repoRoot: ctx.repoRoot, envFile: paths.envFile })
  const previous = readOptional(paths.unitFile)
  if (previous !== unit) {
    mkdirSync(dirname(paths.unitFile), { recursive: true })
    writeFileSync(paths.unitFile, unit)
  }
  io.out(`${previous === undefined ? 'wrote' : previous === unit ? 'unchanged' : 'updated'} ${paths.unitFile}`)

  const wasActive = (await systemctl(ctx.systemd, 'is-active', '--quiet', UNIT_NAME)).code === 0
  if (!(await step(ctx, io, 'systemctl', ['--user', 'daemon-reload']))) return EXIT.failure
  if (!(await step(ctx, io, 'systemctl', ['--user', 'enable', '--now', UNIT_NAME]))) return EXIT.failure
  // enable --now leaves an already active unit on its old definition.
  if (wasActive && previous !== unit && !(await step(ctx, io, 'systemctl', ['--user', 'restart', UNIT_NAME]))) return EXIT.failure

  const lingering = await step(ctx, io, 'loginctl', ['enable-linger', ctx.user])
  if (!lingering) {
    io.err(`without lingering ${UNIT_NAME} only runs while you are logged in; try \`sudo loginctl enable-linger ${ctx.user}\``)
  }

  const healthy = await waitForService(ctx, settings, io, timeoutMs)
  return healthy === EXIT.ok && lingering ? EXIT.ok : EXIT.failure
}

export async function uninstallService(ctx: ServiceContext, io: Io): Promise<number> {
  const paths = servicePaths(ctx.home)
  if (!existsSync(paths.unitFile)) {
    io.out(`${UNIT_NAME} is not installed (${paths.unitFile} does not exist)`)
    return EXIT.ok
  }

  const problem = await checkSystemd(ctx.systemd)
  if (problem) {
    io.out('systemctl --user is unavailable, so the service cannot be running; removing its files only')
  }
  else if (!(await step(ctx, io, 'systemctl', ['--user', 'disable', '--now', UNIT_NAME]))) {
    return EXIT.failure
  }

  rmSync(paths.unitFile, { force: true })
  rmSync(join(dirname(paths.unitFile), 'default.target.wants', UNIT_NAME), { force: true })
  io.out(`removed ${paths.unitFile}`)

  if (!problem) {
    if (!(await step(ctx, io, 'systemctl', ['--user', 'daemon-reload']))) return EXIT.failure
    await systemctl(ctx.systemd, 'reset-failed', UNIT_NAME)
  }

  io.out(`kept ${paths.envFile}; delete it yourself if you no longer need its settings or secrets key`)
  io.out(`lingering is still enabled for other user services; turn it off with \`loginctl disable-linger ${ctx.user}\``)
  return EXIT.ok
}

export async function serviceStart(ctx: ServiceContext, settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const problem = await unreachable(ctx)
  if (problem) return report(io, problem)
  if ((await systemctl(ctx.systemd, 'is-active', '--quiet', UNIT_NAME)).code === 0) {
    return report(io, [`already running under systemd (${UNIT_NAME} is active); use restart`])
  }
  if (!(await step(ctx, io, 'systemctl', ['--user', 'start', UNIT_NAME]))) return EXIT.failure
  return waitForService(ctx, settings, io, timeoutMs)
}

export async function serviceStop(ctx: ServiceContext, io: Io): Promise<number> {
  const problem = await unreachable(ctx)
  if (problem) return report(io, problem)
  return (await step(ctx, io, 'systemctl', ['--user', 'stop', UNIT_NAME])) ? EXIT.ok : EXIT.failure
}

export async function serviceRestart(ctx: ServiceContext, settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const problem = await unreachable(ctx)
  if (problem) return report(io, problem)
  if (!(await step(ctx, io, 'systemctl', ['--user', 'restart', UNIT_NAME]))) return EXIT.failure
  return waitForService(ctx, settings, io, timeoutMs)
}

export async function serviceStatusLine(ctx: ServiceContext): Promise<string> {
  const label = `${'service'.padEnd(7)} ${UNIT_NAME}`
  if (await checkSystemd(ctx.systemd)) return `${label}  installed, but systemctl --user is unavailable`
  const active = firstLine((await systemctl(ctx.systemd, 'is-active', UNIT_NAME)).stdout) || 'unknown'
  const enabled = firstLine((await systemctl(ctx.systemd, 'is-enabled', UNIT_NAME)).stdout) || 'unknown'
  return `${label}  ${active}, ${enabled}`
}

async function unreachable(ctx: ServiceContext): Promise<string[] | undefined> {
  const problem = await checkSystemd(ctx.systemd)
  if (!problem) return undefined
  return [
    `${UNIT_NAME} is installed, so this command goes through systemctl, but:`,
    ...problem.slice(0, -1),
    'Run `candy-mountain uninstall-service` to go back to running without systemd.',
  ]
}

async function waitForService(ctx: ServiceContext, settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await Promise.all(settings.services.map((service) => isHealthy(service.healthUrl)))
    if (health.every(Boolean)) {
      io.out(`${PRODUCT_NAME} is running at ${settings.services[1].url} (${UNIT_NAME})`)
      return EXIT.ok
    }
    if ((await systemctl(ctx.systemd, 'is-failed', '--quiet', UNIT_NAME)).code === 0) break
    await sleep(500)
  }
  io.err(`${UNIT_NAME} did not become healthy within ${Math.round(timeoutMs / 1000)}s`)
  for (const service of settings.services) {
    const tail = readLogTail(service.logFile, 10)
    if (tail.length === 0) continue
    io.err(`last lines of ${service.logFile}:`)
    for (const line of tail) io.err(`  ${line}`)
  }
  io.err('more: systemctl --user status candy-mountain, journalctl --user -u candy-mountain, candy-mountain logs --all')
  return EXIT.failure
}

async function step(ctx: ServiceContext, io: Io, command: string, args: string[]): Promise<boolean> {
  io.out(`$ ${command} ${args.join(' ')}`)
  const result = await ctx.systemd.run(command, args)
  if (result.code === 0) return true
  io.err(`${command} failed (${result.code === null ? 'could not run' : `exit ${result.code}`}): ${result.stderr.trim() || result.stdout.trim()}`)
  return false
}

function report(io: Io, lines: string[]): number {
  for (const line of lines) io.err(line)
  return EXIT.failure
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  }
  catch {
    return undefined
  }
}
