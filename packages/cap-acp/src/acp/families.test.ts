import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AcpLaunchError, assertCodexLaunchOptions, CODEX_LAUNCHER_ENV, claudeShimEntry, codexAdapterEntry, resolveFamilyLaunch, type CodexLaunchOptions } from './families'

const shimBuilt = existsSync(join(dirname(createRequire(import.meta.url).resolve('@candy-mountain/claude-acp/package.json')), 'dist', 'cli.mjs'))

const bins = { claudeShim: { command: '/usr/bin/node', args: ['/shim/cli.mjs'] }, codexAdapter: { command: '/usr/bin/node', args: ['/adapter/index.js'] } }

describe('resolveFamilyLaunch', () => {
  it('runs Claude Code through the shim with the config home and forwarded flags', () => {
    expect(resolveFamilyLaunch('claude-code', { configHome: '/homes/claude', flags: ['--permission-mode', 'plan'], command: '/opt/claude', turnTimeoutMs: 5000 }, bins)).toEqual({
      command: '/usr/bin/node',
      args: ['/shim/cli.mjs', '--config-dir', '/homes/claude', '--claude', '/opt/claude', '--turn-timeout-ms', '5000', '--', '--permission-mode', 'plan'],
      env: {},
    })
    expect(resolveFamilyLaunch('claude-code', { configHome: '/homes/claude' }, bins).args).toEqual(['/shim/cli.mjs', '--config-dir', '/homes/claude', '--'])
  })

  it('launches Codex read-only with the browser off and the adapter defaults cleared', () => {
    expect(resolveFamilyLaunch('codex', { configHome: '/homes/codex', command: '/opt/codex' }, bins)).toEqual({
      command: '/usr/bin/node',
      args: ['/adapter/index.js'],
      env: {
        CODEX_HOME: '/homes/codex',
        NO_BROWSER: '1',
        DEFAULT_AUTH_REQUEST: '',
        APP_SERVER_LOGS: '',
        INITIAL_AGENT_MODE: 'read-only',
        CODEX_CONFIG: '',
        CODEX_PATH: '/opt/codex',
      },
    })
    expect(resolveFamilyLaunch('codex', { configHome: '/homes/codex' }, bins).env).not.toHaveProperty('CODEX_PATH')
  })

  it('passes persona text as developer instructions in the adapter config', () => {
    const launch = resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex: { developerInstructions: '  You are Pip.\nBe brief.  ' } }, bins)
    expect(JSON.parse(launch.env.CODEX_CONFIG!)).toEqual({ developer_instructions: 'You are Pip.\nBe brief.' })
    expect(resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex: { developerInstructions: ' \n' } }, bins).env.CODEX_CONFIG).toBe('')
  })

  it('passes a chosen model and reasoning effort next to the persona and keeps the read-only mode', () => {
    const launch = resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex: { developerInstructions: 'You are Pip.', model: 'gpt-5.5-codex', reasoningEffort: 'high' } }, bins)
    expect(JSON.parse(launch.env.CODEX_CONFIG!)).toEqual({ developer_instructions: 'You are Pip.', model: 'gpt-5.5-codex', model_reasoning_effort: 'high' })
    expect(launch.env.INITIAL_AGENT_MODE).toBe('read-only')
    expect(JSON.parse(resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex: { model: 'gpt-5.5' } }, bins).env.CODEX_CONFIG!)).toEqual({ model: 'gpt-5.5' })
  })

  it('refuses a model or effort that is not a plain id', () => {
    const launch = (codex: { model?: string, reasoningEffort?: string }) => () => resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex }, bins)
    expect(launch({ model: 'gpt-5"\napprovals_reviewer = "auto_review' })).toThrow(AcpLaunchError)
    expect(launch({ model: '' })).toThrow(AcpLaunchError)
    expect(launch({ model: '-gpt' })).toThrow(AcpLaunchError)
    expect(launch({ reasoningEffort: 'High Effort' })).toThrow(AcpLaunchError)
    expect(launch({ reasoningEffort: '' })).toThrow(AcpLaunchError)
  })

  it('adds writable roots to the workspace-write sandbox config and the session directories', () => {
    const launch = resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex: { mode: 'workspace-write', developerInstructions: 'You are Pip.', writableRoots: ['/work/alpha/.beads', '/work/alpha/.beads'] } }, bins)
    expect(JSON.parse(launch.env.CODEX_CONFIG!)).toEqual({ developer_instructions: 'You are Pip.', sandbox_workspace_write: { writable_roots: ['/work/alpha/.beads'] } })
    expect(launch.additionalDirectories).toEqual(['/work/alpha/.beads'])
    expect(launch.env.INITIAL_AGENT_MODE).toBe('workspace-write')
    const none = resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex: { mode: 'workspace-write', writableRoots: [] } }, bins)
    expect(none.env.CODEX_CONFIG).toBe('')
    expect(none).not.toHaveProperty('additionalDirectories')
  })

  it('refuses writable roots outside the workspace-write mode or given as relative paths', () => {
    const launch = (codex: CodexLaunchOptions) => () => resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex }, bins)
    expect(launch({ writableRoots: ['/work/alpha/.beads'] })).toThrow(/need the workspace-write mode, not read-only/)
    expect(launch({ mode: 'read-only', writableRoots: ['/work/alpha/.beads'] })).toThrow(AcpLaunchError)
    expect(launch({ mode: 'agent' as 'read-only', writableRoots: ['/work/alpha/.beads'] })).toThrow(/auto-review/)
    expect(launch({ mode: 'workspace-write', writableRoots: ['.beads'] })).toThrow(/absolute path/)
    expect(launch({ mode: 'workspace-write', writableRoots: [''] })).toThrow(/absolute path/)
    expect(() => assertCodexLaunchOptions({ mode: 'read-only', writableRoots: ['/work/alpha/.beads'] })).toThrow(AcpLaunchError)
    expect(() => assertCodexLaunchOptions({ mode: 'workspace-write', writableRoots: ['/work/alpha/.beads'] })).not.toThrow()
  })

  it('allows the workspace-write mode', () => {
    expect(resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex: { mode: 'workspace-write' } }, bins).env.INITIAL_AGENT_MODE).toBe('workspace-write')
  })

  it('refuses the auto-review and full-access modes and any id the adapter would replace with auto-review', () => {
    const launch = (mode: string) => () => resolveFamilyLaunch('codex', { configHome: '/homes/codex', codex: { mode: mode as 'read-only' } }, bins)
    expect(launch('agent')).toThrow(AcpLaunchError)
    expect(launch('agent')).toThrow(/auto-review/)
    expect(launch('agent-full-access')).toThrow(/sandbox/)
    expect(launch('Read-Only')).toThrow(/Unknown Codex mode/)
    expect(launch('')).toThrow(AcpLaunchError)
  })

  it('refuses Codex posture smuggled through env or adapter arguments', () => {
    expect(() => resolveFamilyLaunch('codex', { configHome: '/homes/codex', env: { INITIAL_AGENT_MODE: 'agent' } }, bins)).toThrow(AcpLaunchError)
    for (const name of CODEX_LAUNCHER_ENV) {
      expect(() => resolveFamilyLaunch('codex', { configHome: '/homes/codex', env: { [name]: '' } }, bins), name).toThrow(AcpLaunchError)
    }
    expect(() => resolveFamilyLaunch('codex', { configHome: '/homes/codex', env: { CODEX_CONFIG: '{"approvals_reviewer":"auto_review"}' } }, bins)).toThrow(/CODEX_CONFIG/)
    expect(() => resolveFamilyLaunch('codex', { configHome: '/homes/codex', flags: ['login'] }, bins)).toThrow(AcpLaunchError)
    expect(() => resolveFamilyLaunch('codex', { configHome: '/homes/codex', flags: ['cli', '--dangerously-bypass-approvals-and-sandbox'] }, bins)).toThrow(AcpLaunchError)
    expect(resolveFamilyLaunch('codex', { configHome: '/homes/codex', env: { CLAUDE_CODE_OAUTH_TOKEN: 'x' } }, bins).env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN')
  })

  it('refuses codex options on the Claude Code family', () => {
    expect(() => resolveFamilyLaunch('claude-code', { configHome: '/homes/claude', codex: { mode: 'read-only' } }, bins)).toThrow(AcpLaunchError)
  })

  it('refuses a relative config home', () => {
    expect(() => resolveFamilyLaunch('codex', { configHome: 'relative' }, bins)).toThrow(AcpLaunchError)
  })

  it('finds the installed Codex adapter', () => {
    const adapter = codexAdapterEntry()
    expect(adapter.command).toBe(process.execPath)
    expect(existsSync(adapter.args[0]!)).toBe(true)
  })

  it('pins the adapter version whose modes and environment were verified', () => {
    // CODEX_MODE_POSTURE and CODEX_LAUNCHER_ENV were read from this version; re-verify both before bumping it.
    expect(createRequire(import.meta.url)('@agentclientprotocol/codex-acp/package.json').version).toBe('2.3.0')
  })

  it.skipIf(!shimBuilt)('finds the built Claude shim', () => {
    expect(claudeShimEntry().args[0]).toMatch(/claude-acp[\\/]dist[\\/]cli\.mjs$/)
  })
})
