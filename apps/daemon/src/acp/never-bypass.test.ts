import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpBypassRefusedError, AcpLaunchError, assertClaudeNeverBypass, resolveFamilyLaunch } from './families'
import { createAcpHarness } from './harness'
import { createTempHome, fakeBins, type TempHome } from './test-support'

const bins = { claudeShim: { command: '/usr/bin/node', args: ['/shim/cli.mjs'] }, codexAdapter: { command: '/usr/bin/node', args: ['/adapter/index.js'] } }

function refusal(flags: string[]): AcpBypassRefusedError | null {
  try {
    assertClaudeNeverBypass(flags)
    return null
  }
  catch (error) {
    if (error instanceof AcpBypassRefusedError) return error
    throw error
  }
}

let home: TempHome | undefined
afterEach(() => {
  home?.cleanup()
  home = undefined
})

describe('never-bypass rule for Claude Code', () => {
  it.each([
    [['--dangerously-skip-permissions'], '--dangerously-skip-permissions'],
    [['--allow-dangerously-skip-permissions'], '--allow-dangerously-skip-permissions'],
    [['--permission-mode', 'bypassPermissions'], '--permission-mode'],
    [['--permission-mode=bypassPermissions'], '--permission-mode'],
    [['--permission-mode', 'auto'], '--permission-mode'],
    [['--permission-mode', 'yolo'], '--permission-mode'],
    [['--permission-prompt-tool', 'mcp__approve__all'], '--permission-prompt-tool'],
    [['--allowedTools', '*'], '--allowedTools'],
    [['--allowedTools', 'Read', 'Bash'], '--allowedTools'],
    [['--allowed-tools', 'Bash(*)'], '--allowed-tools'],
    [['--allowedTools', 'Bash(bd *),Bash(:*)'], '--allowedTools'],
    [['--settings', JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } })], '--settings'],
    [['--settings', JSON.stringify({ permissions: { defaultMode: 'auto' } })], '--settings .permissions.defaultMode'],
    [['--settings', JSON.stringify({ permissions: { allow: ['Bash'] } })], '--settings .permissions.allow'],
    [['--settings', 'relative.json'], '--settings'],
    [['--settings', '{not json'], '--settings'],
    [['--agents', JSON.stringify({ helper: { description: 'x', prompt: 'y', permissionMode: 'auto' } })], '--agents .helper.permissionMode'],
    [['--mcp-config', '{"note":"bypassPermissions"}'], '--mcp-config'],
  ])('refuses %j by name', (flags, setting) => {
    const error = refusal(flags)
    expect(error?.setting).toBe(setting)
    expect(error?.code).toBe('bypass_refused')
    expect(() => resolveFamilyLaunch('claude-code', { configHome: '/homes/claude', flags }, bins)).toThrow(AcpBypassRefusedError)
  })

  it('refuses a settings file that turns on bypass and reads an absolute one that does not', () => {
    home = createTempHome()
    mkdirSync(home.root, { recursive: true })
    const bad = join(home.root, 'bad.json')
    const good = join(home.root, 'good.json')
    writeFileSync(bad, JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }))
    writeFileSync(good, JSON.stringify({ permissions: { defaultMode: 'default', ask: ['Bash(git push *)'] } }))
    expect(refusal(['--settings', bad])?.setting).toBe('--settings .permissions.defaultMode')
    expect(refusal(['--settings', good])).toBeNull()
    expect(refusal(['--settings', join(home.root, 'missing.json')])?.message).toMatch(/could not be read/)
  })

  it('accepts a posture that keeps every prompt with the human', () => {
    const settings = JSON.stringify({ disableAllHooks: true, permissions: { defaultMode: 'plan', disableBypassPermissionsMode: 'disable', disableAutoMode: 'disable', deny: ['Edit(/tmp/**)'] } })
    const flags = ['--permission-mode', 'plan', '--settings', settings, '--strict-mcp-config', '--agent', 'pip', '--append-system-prompt', 'Never use bypassPermissions.', '--allowedTools', 'Bash(bd *)', 'mcp__issues__*', '--disallowedTools', 'ExitPlanMode,Agent,Workflow']
    expect(refusal(flags)).toBeNull()
    expect(resolveFamilyLaunch('claude-code', { configHome: '/homes/claude', flags }, bins).args.slice(-flags.length)).toEqual(flags)
  })

  it('refuses a bypass launch before anything is spawned', async () => {
    home = createTempHome()
    mkdirSync(home.cwd, { recursive: true })
    const harness = createAcpHarness({ bins: fakeBins, killTimeoutMs: 1000 })
    try {
      const start = harness.startSession({ family: 'claude-code', cwd: home.cwd, configHome: home.configHome, flags: ['--permission-mode', 'bypassPermissions'] })
      await expect(start).rejects.toThrow(AcpBypassRefusedError)
      await expect(start).rejects.toThrow(AcpLaunchError)
      expect(harness.list()).toEqual([])
      expect(existsSync(home.configHome)).toBe(false)
    }
    finally {
      await harness.close()
    }
  })
})
