import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EXIT, stop, type Io } from './commands'
import type { Names } from './distribution'
import { isRunning, readPidFile } from './pid-file'
import { isHealthy, sleep } from './probe'
import type { Settings } from './settings'
import { readLogTail } from './supervisor'
import { checkSystemd, firstLine, systemctl, type SystemdHost } from './systemd'
import { ENV_KEYS, parseEnvFile, renderEnvFile, renderUnit, servicePaths } from './unit-files'

export interface ServiceContext {
  names: Names
  cliEntry: string
  root: string
  home: string
  nodePath: string
  user: string
  /** The PATH written into a new environment file. */
  path: string | undefined
  systemd: SystemdHost
}

export function isServiceInstalled(ctx: ServiceContext): boolean {
  return existsSync(servicePaths(ctx.home, ctx.names).unitFile)
}

/** The CM_* values from the service's environment file, which win over the shell so the CLI looks where the service runs. */
export function serviceEnvOverrides(ctx: ServiceContext): NodeJS.ProcessEnv {
  let source: string
  try {
    source = readFileSync(servicePaths(ctx.home, ctx.names).envFile, 'utf8')
  }
  catch {
    return {}
  }
  const parsed = parseEnvFile(source)
  return Object.fromEntries(ENV_KEYS.flatMap((key) => (parsed[key] ? [[key, parsed[key]]] : [])))
}

export async function installService(ctx: ServiceContext, settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const problem = await checkSystemd(ctx.systemd, ctx.names)
  if (problem) return report(io, problem)

  const paths = servicePaths(ctx.home, ctx.names)
  const missing = [ctx.cliEntry, ...settings.services.map((service) => service.entry)].filter((file) => !existsSync(file))
  if (missing.length > 0) return report(io, [...missing.map((file) => `not built: ${file} is missing`), 'run pnpm build, then install-service again'])

  const detached = settings.services.some((service) => {
    const record = readPidFile(service.pidFile)
    return record && isRunning(record) && !record.supervisor
  })
  if (detached) {
    io.out(`stopping the copy started with \`${ctx.names.command} start\` so the service can take over`)
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

  const unit = renderUnit({ names: ctx.names, nodePath: ctx.nodePath, cliEntry: ctx.cliEntry, root: ctx.root, envFile: paths.envFile })
  const previous = readOptional(paths.unitFile)
  if (previous !== unit) {
    mkdirSync(dirname(paths.unitFile), { recursive: true })
    writeFileSync(paths.unitFile, unit)
  }
  io.out(`${previous === undefined ? 'wrote' : previous === unit ? 'unchanged' : 'updated'} ${paths.unitFile}`)

  const wasActive = (await systemctl(ctx.systemd, 'is-active', '--quiet', ctx.names.unit)).code === 0
  if (!(await step(ctx, io, 'systemctl', ['--user', 'daemon-reload']))) return EXIT.failure
  if (!(await step(ctx, io, 'systemctl', ['--user', 'enable', '--now', ctx.names.unit]))) return EXIT.failure
  // enable --now leaves an already active unit on its old definition.
  if (wasActive && previous !== unit && !(await step(ctx, io, 'systemctl', ['--user', 'restart', ctx.names.unit]))) return EXIT.failure

  const lingering = await step(ctx, io, 'loginctl', ['enable-linger', ctx.user])
  if (!lingering) {
    io.err(`without lingering ${ctx.names.unit} only runs while you are logged in; try \`sudo loginctl enable-linger ${ctx.user}\``)
  }

  const healthy = await waitForService(ctx, settings, io, timeoutMs)
  return healthy === EXIT.ok && lingering ? EXIT.ok : EXIT.failure
}

export async function uninstallService(ctx: ServiceContext, io: Io): Promise<number> {
  const paths = servicePaths(ctx.home, ctx.names)
  if (!existsSync(paths.unitFile)) {
    io.out(`${ctx.names.unit} is not installed (${paths.unitFile} does not exist)`)
    return EXIT.ok
  }

  const problem = await checkSystemd(ctx.systemd, ctx.names)
  if (problem) {
    io.out('systemctl --user is unavailable, so the service cannot be running; removing its files only')
  }
  else if (!(await step(ctx, io, 'systemctl', ['--user', 'disable', '--now', ctx.names.unit]))) {
    return EXIT.failure
  }

  rmSync(paths.unitFile, { force: true })
  rmSync(join(dirname(paths.unitFile), 'default.target.wants', ctx.names.unit), { force: true })
  io.out(`removed ${paths.unitFile}`)

  if (!problem) {
    if (!(await step(ctx, io, 'systemctl', ['--user', 'daemon-reload']))) return EXIT.failure
    await systemctl(ctx.systemd, 'reset-failed', ctx.names.unit)
  }

  io.out(`kept ${paths.envFile}; delete it yourself if you no longer need its settings or secrets key`)
  io.out(`lingering is still enabled for other user services; turn it off with \`loginctl disable-linger ${ctx.user}\``)
  return EXIT.ok
}

export async function serviceStart(ctx: ServiceContext, settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const problem = await unreachable(ctx)
  if (problem) return report(io, problem)
  if ((await systemctl(ctx.systemd, 'is-active', '--quiet', ctx.names.unit)).code === 0) {
    return report(io, [`already running under systemd (${ctx.names.unit} is active); use restart`])
  }
  if (!(await step(ctx, io, 'systemctl', ['--user', 'start', ctx.names.unit]))) return EXIT.failure
  return waitForService(ctx, settings, io, timeoutMs)
}

export async function serviceStop(ctx: ServiceContext, io: Io): Promise<number> {
  const problem = await unreachable(ctx)
  if (problem) return report(io, problem)
  return (await step(ctx, io, 'systemctl', ['--user', 'stop', ctx.names.unit])) ? EXIT.ok : EXIT.failure
}

export async function serviceRestart(ctx: ServiceContext, settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const problem = await unreachable(ctx)
  if (problem) return report(io, problem)
  if (!(await step(ctx, io, 'systemctl', ['--user', 'restart', ctx.names.unit]))) return EXIT.failure
  return waitForService(ctx, settings, io, timeoutMs)
}

export async function serviceStatusLine(ctx: ServiceContext): Promise<string> {
  const label = `${'service'.padEnd(7)} ${ctx.names.unit}`
  if (await checkSystemd(ctx.systemd, ctx.names)) return `${label}  installed, but systemctl --user is unavailable`
  const active = firstLine((await systemctl(ctx.systemd, 'is-active', ctx.names.unit)).stdout) || 'unknown'
  const enabled = firstLine((await systemctl(ctx.systemd, 'is-enabled', ctx.names.unit)).stdout) || 'unknown'
  return `${label}  ${active}, ${enabled}`
}

async function unreachable(ctx: ServiceContext): Promise<string[] | undefined> {
  const problem = await checkSystemd(ctx.systemd, ctx.names)
  if (!problem) return undefined
  return [
    `${ctx.names.unit} is installed, so this command goes through systemctl, but:`,
    ...problem.slice(0, -1),
    `Run \`${ctx.names.command} uninstall-service\` to go back to running without systemd.`,
  ]
}

async function waitForService(ctx: ServiceContext, settings: Settings, io: Io, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await Promise.all(settings.services.map((service) => isHealthy(service.healthUrl)))
    if (health.every(Boolean)) {
      io.out(`${ctx.names.product} is running at ${settings.services[1].url} (${ctx.names.unit})`)
      return EXIT.ok
    }
    if ((await systemctl(ctx.systemd, 'is-failed', '--quiet', ctx.names.unit)).code === 0) break
    await sleep(500)
  }
  io.err(`${ctx.names.unit} did not become healthy within ${Math.round(timeoutMs / 1000)}s`)
  for (const service of settings.services) {
    const tail = readLogTail(service.logFile, 10)
    if (tail.length === 0) continue
    io.err(`last lines of ${service.logFile}:`)
    for (const line of tail) io.err(`  ${line}`)
  }
  const { command } = ctx.names
  io.err(`more: systemctl --user status ${command}, journalctl --user -u ${command}, ${command} logs --all`)
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
