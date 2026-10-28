import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

export interface CommandResult {
  /** null when the command could not be run at all. */
  code: number | null
  stdout: string
  stderr: string
}

export type Runner = (command: string, args: string[]) => Promise<CommandResult>

export interface SystemdHost {
  run: Runner
  /** True when systemd is PID 1 (the sd_booted() check). */
  booted(): boolean
  initName(): string
  wsl(): boolean
}

export const runCommand: Runner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.once('error', (error) => resolve({ code: null, stdout, stderr: error.message }))
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })

export const localSystemd: SystemdHost = {
  run: runCommand,
  booted: () => existsSync('/run/systemd/system'),
  initName: () => readText('/proc/1/comm') || 'unknown',
  wsl: () => Boolean(process.env.WSL_DISTRO_NAME) || /microsoft/i.test(readText('/proc/sys/kernel/osrelease')),
}

/** Resolves to undefined when `systemctl --user` works, otherwise to the lines explaining why it does not. */
export async function checkSystemd(host: SystemdHost): Promise<string[] | undefined> {
  const intro = 'systemd user services are not available on this machine:'
  const fallback = 'Until then, `candy-mountain start` runs Candy Mountain in the background without a service.'

  const version = await host.run('systemctl', ['--version'])
  if (version.code === null) {
    return [`${intro} the systemctl command was not found, so this system does not use systemd.`, fallback]
  }

  if (!host.booted()) {
    const lines = [`${intro} systemd is installed but is not the init system (PID 1 is ${host.initName()}).`]
    if (host.wsl()) {
      lines.push(
        'This is WSL, where systemd is off unless enabled. Add this to /etc/wsl.conf (as root):',
        '  [boot]',
        '  systemd=true',
        'then run `wsl.exe --shutdown` from Windows and open a new WSL terminal.',
      )
    }
    return [...lines, fallback]
  }

  const bus = await host.run('systemctl', ['--user', 'show-environment'])
  if (bus.code !== 0) {
    return [
      `${intro} \`systemctl --user\` could not reach your user service manager (${firstLine(bus.stderr) || `exit ${bus.code}`}).`,
      'Run this from a normal login shell for your own user (not through sudo or su), where XDG_RUNTIME_DIR is /run/user/<uid>.',
      fallback,
    ]
  }
  return undefined
}

export function systemctl(host: SystemdHost, ...args: string[]): Promise<CommandResult> {
  return host.run('systemctl', ['--user', ...args])
}

export function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim()
  }
  catch {
    return ''
  }
}
