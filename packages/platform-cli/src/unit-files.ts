import { join } from 'node:path'
import type { Names } from './distribution'
import type { Settings } from './settings'

export interface ServicePaths {
  unitFile: string
  envDir: string
  envFile: string
}

// Fixed under ~/.config rather than $XDG_CONFIG_HOME because the user manager, not this shell, decides where units are read from.
export function servicePaths(home: string, names: Names): ServicePaths {
  const envDir = join(home, '.config', names.command)
  return {
    unitFile: join(home, '.config', 'systemd', 'user', names.unit),
    envDir,
    envFile: join(envDir, 'service.env'),
  }
}

export interface UnitOptions {
  names: Names
  nodePath: string
  cliEntry: string
  root: string
  envFile: string
}

/** Stop budget: `run` stops web then daemon, each with a 15 s grace before SIGKILL. */
const STOP_TIMEOUT_S = 45

export function renderUnit({ names, nodePath, cliEntry, root, envFile }: UnitOptions): string {
  return `[Unit]
Description=${names.product} daemon and web server

[Service]
Type=simple
WorkingDirectory=${unitPath(root)}
EnvironmentFile=${unitPath(envFile)}
ExecStart=${execArg(nodePath)} ${execArg(cliEntry)} run
Restart=on-failure
RestartSec=5
TimeoutStopSec=${STOP_TIMEOUT_S}

[Install]
WantedBy=default.target
`
}

export const ENV_KEYS = ['CM_DATA_DIR', 'CM_DAEMON_HOST', 'CM_DAEMON_PORT', 'CM_WEB_HOST', 'CM_WEB_PORT'] as const

export function renderEnvFile(settings: Settings, path: string | undefined): string {
  const [daemon, web] = settings.services
  const { unit, command } = settings.names
  const values: Record<(typeof ENV_KEYS)[number], string> = {
    CM_DATA_DIR: settings.dataDir,
    CM_DAEMON_HOST: daemon.address.host,
    CM_DAEMON_PORT: String(daemon.address.port),
    CM_WEB_HOST: web.address.host,
    CM_WEB_PORT: String(web.address.port),
  }
  const lines = [
    `# Environment for ${unit}. After editing: systemctl --user restart ${command}`,
    ...ENV_KEYS.map((key) => `${key}=${envValue(values[key])}`),
    ...(path
      ? ['', '# The service does not read your shell profile; this is the PATH it runs tools such as git and bd with.', `PATH=${envValue(path)}`]
      : []),
    '',
    '# Secrets master key, 32 bytes base64 (openssl rand -base64 32). Keep a copy outside the data directory.',
    '# CM_SECRETS_KEY=',
    '',
  ]
  return lines.join('\n')
}

/** Reads the KEY=VALUE lines renderEnvFile writes, so the CLI can follow the ports the service actually uses. */
export function parseEnvFile(source: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const match = /^(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, value] = match as unknown as [string, string, string]
    values[key] = unquote(value)
  }
  return values
}

function unquote(value: string): string {
  const quote = value[0]
  if ((quote === '"' || quote === '\'') && value.endsWith(quote) && value.length >= 2) {
    const inner = value.slice(1, -1)
    return quote === '"' ? inner.replace(/\\(["\\$`])/g, '$1') : inner
  }
  return value
}

function envValue(value: string): string {
  assertSingleLine(value)
  return /^[\w@%+=:,./-]*$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

// systemd expands %-specifiers in every path setting.
function unitPath(path: string): string {
  assertSingleLine(path)
  return path.replaceAll('%', '%%')
}

function execArg(arg: string): string {
  const escaped = unitPath(arg).replaceAll('$', '$$$$')
  return /^[^\s"'\\;]+$/.test(escaped) ? escaped : `"${escaped.replace(/(["\\])/g, '\\$1')}"`
}

function assertSingleLine(value: string): void {
  if (/[\n\r]/.test(value)) throw new Error(`cannot write a value containing a line break into a systemd file: ${JSON.stringify(value)}`)
}
