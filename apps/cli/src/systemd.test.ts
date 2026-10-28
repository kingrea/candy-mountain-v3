import { describe, expect, it } from 'vitest'
import { checkSystemd, type CommandResult, type SystemdHost } from './systemd'

function host(options: { systemctl?: boolean, booted?: boolean, wsl?: boolean, bus?: CommandResult }): SystemdHost {
  return {
    run: async (command, args) => {
      if (command !== 'systemctl' || options.systemctl === false) return { code: null, stdout: '', stderr: `spawn ${command} ENOENT` }
      if (args[0] === '--version') return { code: 0, stdout: 'systemd 255', stderr: '' }
      return options.bus ?? { code: 0, stdout: 'HOME=/home/jack\n', stderr: '' }
    },
    booted: () => options.booted ?? true,
    initName: () => 'init',
    wsl: () => options.wsl ?? false,
  }
}

describe('checkSystemd', () => {
  it('passes when systemctl --user reaches the user manager', async () => {
    expect(await checkSystemd(host({}))).toBeUndefined()
  })

  it('explains a system without systemctl', async () => {
    const lines = await checkSystemd(host({ systemctl: false }))
    expect(lines?.[0]).toMatch(/systemctl command was not found/)
    expect(lines?.at(-1)).toMatch(/candy-mountain start/)
  })

  it('tells WSL users how to turn systemd on', async () => {
    expect(await checkSystemd(host({ booted: false, wsl: true }))).toMatchInlineSnapshot(`
      [
        "systemd user services are not available on this machine: systemd is installed but is not the init system (PID 1 is init).",
        "This is WSL, where systemd is off unless enabled. Add this to /etc/wsl.conf (as root):",
        "  [boot]",
        "  systemd=true",
        "then run \`wsl.exe --shutdown\` from Windows and open a new WSL terminal.",
        "Until then, \`candy-mountain start\` runs Candy Mountain in the background without a service.",
      ]
    `)
  })

  it('leaves out the WSL steps elsewhere', async () => {
    const lines = await checkSystemd(host({ booted: false }))
    expect(lines?.join('\n')).not.toMatch(/wsl/i)
  })

  it('reports a user bus it cannot connect to', async () => {
    const lines = await checkSystemd(host({ bus: { code: 1, stdout: '', stderr: 'Failed to connect to bus: No such file or directory\n' } }))
    expect(lines?.[0]).toBe('systemd user services are not available on this machine: `systemctl --user` could not reach your user service manager (Failed to connect to bus: No such file or directory).')
  })
})
