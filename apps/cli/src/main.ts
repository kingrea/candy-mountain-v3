import { homedir, userInfo } from 'node:os'
import { parseArgs } from 'node:util'
import { EXIT, logs, restart, run, start, status, stop, type Io, type LogsOptions } from './commands'
import {
  installService,
  isServiceInstalled,
  serviceEnvOverrides,
  serviceRestart,
  serviceStart,
  serviceStatusLine,
  serviceStop,
  uninstallService,
  type ServiceContext,
} from './service'
import { resolveSettings } from './settings'
import { localSystemd, type SystemdHost } from './systemd'

export const USAGE = `Usage: candy-mountain <command> [options]

Commands:
  start     Start the daemon and web server in the background
  stop      Stop both
  restart   Stop, then start
  status    Show whether each is running, and on which port
  logs      Tail the daemon log (--web for the web log, --all for both)
  run       Run both in the foreground until SIGTERM, for a service manager

  install-service    Install, enable and start a systemd user service that
                     runs both at boot; start/stop/restart then use systemctl
  uninstall-service  Stop, disable and remove that service

Options:
  --timeout <seconds>  start/run: wait for health (default 60)
                       stop: wait before SIGKILL (default 15)
  -n, --lines <count>  logs: lines of history to show (default 50)
  --no-follow          logs: print and exit instead of following
  -h, --help           Show this help

Environment: CM_DATA_DIR, CM_DAEMON_HOST, CM_DAEMON_PORT, CM_WEB_HOST, CM_WEB_PORT
(with the service installed, its ~/.config/candy-mountain/service.env wins)`

const DEFAULT_START_TIMEOUT_S = 60
const DEFAULT_STOP_TIMEOUT_S = 15

export interface MainContext {
  repoRoot: string
  env?: NodeJS.ProcessEnv
  io?: Io
  /** Where the systemd unit and its environment file live; tests point this at a temp dir. */
  home?: string
  systemd?: SystemdHost
}

const consoleIo: Io = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}

export async function main(argv: string[], context: MainContext): Promise<number> {
  const io = context.io ?? consoleIo
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      allowNegative: true,
      options: {
        'timeout': { type: 'string' },
        'lines': { type: 'string', short: 'n', default: '50' },
        'follow': { type: 'boolean', default: true },
        'web': { type: 'boolean', default: false },
        'all': { type: 'boolean', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
      },
    })
  }
  catch (error) {
    io.err((error as Error).message)
    io.err(USAGE)
    return EXIT.usage
  }

  const { values, positionals } = parsed
  const [command, ...extra] = positionals
  if (values.help || command === 'help' || command === undefined) {
    io.out(USAGE)
    return command === undefined && !values.help ? EXIT.usage : EXIT.ok
  }
  if (extra.length > 0) return usageError(io, `unexpected argument: ${extra[0]}`)

  const timeoutS = values.timeout === undefined ? undefined : Number(values.timeout)
  if (timeoutS !== undefined && !(timeoutS > 0)) return usageError(io, `--timeout must be a positive number of seconds`)
  const lines = Number(values.lines)
  if (!Number.isInteger(lines) || lines < 0) return usageError(io, `--lines must be a whole number`)
  const startMs = (timeoutS ?? DEFAULT_START_TIMEOUT_S) * 1000
  const stopMs = (timeoutS ?? DEFAULT_STOP_TIMEOUT_S) * 1000

  const home = context.home ?? homedir()
  const baseEnv = context.env ?? process.env
  const installed = isServiceInstalled(home)
  const env = installed || command === 'install-service' ? { ...baseEnv, ...serviceEnvOverrides(home) } : baseEnv
  const service: ServiceContext = {
    repoRoot: context.repoRoot,
    home,
    nodePath: process.execPath,
    user: baseEnv.USER || userInfo().username,
    path: baseEnv.PATH,
    systemd: context.systemd ?? localSystemd,
  }

  let settings
  try {
    settings = resolveSettings(context.repoRoot, env)
  }
  catch (error) {
    io.err((error as Error).message)
    return EXIT.usage
  }

  switch (command) {
    case 'start':
      return installed ? serviceStart(service, settings, io, startMs) : start(settings, io, startMs)
    case 'stop':
      return installed ? serviceStop(service, io) : stop(settings, io, stopMs)
    case 'restart':
      return installed ? serviceRestart(service, settings, io, startMs) : restart(settings, io, { stopMs, startMs })
    case 'status': {
      const code = await status(settings, io)
      if (installed) io.out(await serviceStatusLine(service))
      return code
    }
    case 'logs': {
      const which: LogsOptions['which'] = values.all ? 'all' : values.web ? 'web' : 'daemon'
      return logs(settings, io, { which, lines, follow: values.follow })
    }
    case 'run':
      return run(settings, io, { stopMs, startMs })
    case 'install-service':
      return installService(service, settings, io, startMs)
    case 'uninstall-service':
      return uninstallService(service, io)
    default:
      return usageError(io, `unknown command: ${command}`)
  }
}

function usageError(io: Io, message: string): number {
  io.err(message)
  io.err(USAGE)
  return EXIT.usage
}
