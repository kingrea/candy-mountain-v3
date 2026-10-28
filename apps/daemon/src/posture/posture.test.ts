import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOT_FAMILIES, BOT_WRITE_SCOPES, type BotFamily, type BotWriteScope } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFamilyLaunch } from '../acp/families'
import { CLAUDE_BASELINE_ALLOWED_TOOLS, CLAUDE_PUSH_ASK_RULES } from './claude'
import { PostureError } from './errors'
import { assertPostureNotWidened, resolveBotPosture, type BotPosture } from './index'

const CHECKOUT = '/work/alpha'
const CLAUDE_PERSONA = ['---', 'name: pip', 'description: Fixes small issues', 'tools: Read, Grep, Bash', '---', '', 'You are Pip.'].join('\n')
const CODEX_PERSONA = 'You are Pip. Be brief.'
const SURFACE = '# Platform instructions\nStay on the branch.'

function resolve(family: BotFamily, writeScope: BotWriteScope, extra: Partial<Parameters<typeof resolveBotPosture>[0]> = {}): BotPosture {
  return resolveBotPosture({
    family,
    writeScope,
    personaName: 'pip',
    personaText: family === 'codex' ? CODEX_PERSONA : CLAUDE_PERSONA,
    surfaceInstructions: SURFACE,
    checkoutDir: CHECKOUT,
    checkoutSettings: [],
    ...extra,
  })
}

function settingsOf(posture: BotPosture): Record<string, unknown> {
  const index = posture.flags.indexOf('--settings')
  return JSON.parse(posture.flags[index + 1]!)
}

function flagValue(posture: BotPosture, flag: string): string | undefined {
  const index = posture.flags.indexOf(flag)
  return index === -1 ? undefined : posture.flags[index + 1]
}

describe('resolveBotPosture for Claude Code', () => {
  it('maps read-only to plan mode with the plan exit and subagent tools denied', () => {
    const posture = resolve('claude-code', 'read-only')
    expect(posture.flags).toEqual([
      '--permission-mode', 'plan',
      '--settings', JSON.stringify(posture.settingsOverrides),
      '--strict-mcp-config',
      '--agent', 'pip',
      '--append-system-prompt', SURFACE,
      '--allowedTools', 'Bash(bd *)',
      '--disallowedTools', 'ExitPlanMode,Agent,Workflow',
    ])
    expect(posture.settingsOverrides).toEqual({
      disableAllHooks: true,
      enableAllProjectMcpServers: false,
      useAutoModeDuringPlan: false,
      permissions: { defaultMode: 'plan', disableBypassPermissionsMode: 'disable', disableAutoMode: 'disable' },
      sandbox: { enabled: false },
    })
    expect(posture.env).toEqual({})
    expect(posture.codex).toBeUndefined()
    expect(posture.neutralised).toEqual([])
  })

  it('maps write-confirm to the default mode with subagents denied and no sandbox', () => {
    const posture = resolve('claude-code', 'write-confirm')
    expect(flagValue(posture, '--permission-mode')).toBe('default')
    expect(flagValue(posture, '--disallowedTools')).toBe('Agent,Workflow')
    expect(posture.settingsOverrides).toEqual({
      disableAllHooks: true,
      enableAllProjectMcpServers: false,
      permissions: { defaultMode: 'default', disableBypassPermissionsMode: 'disable', disableAutoMode: 'disable' },
      sandbox: { enabled: false },
    })
  })

  it('maps write-auto to acceptEdits with a required sandbox and git push always asking', () => {
    const posture = resolve('claude-code', 'write-auto')
    expect(flagValue(posture, '--permission-mode')).toBe('acceptEdits')
    expect(posture.flags).not.toContain('--disallowedTools')
    expect(posture.settingsOverrides).toEqual({
      disableAllHooks: true,
      enableAllProjectMcpServers: false,
      permissions: { defaultMode: 'acceptEdits', disableBypassPermissionsMode: 'disable', disableAutoMode: 'disable', ask: ['Bash(git push *)'] },
      sandbox: {
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        enableWeakerNestedSandbox: false,
        excludedCommands: ['bd *'],
        filesystem: { allowWrite: ['~/.local/share/pnpm/store', '~/.cache/pnpm', '~/.npm'] },
        network: { allowedDomains: ['github.com', 'api.github.com', 'bitbucket.org', 'api.bitbucket.org', 'registry.npmjs.org'], allowLocalBinding: false, allowAllUnixSockets: false },
      },
    })
  })

  it('takes the sandbox domains and writable paths from the caller', () => {
    const posture = resolve('claude-code', 'write-auto', { claude: { sandboxAllowedDomains: ['git.example.com'], sandboxAllowWrite: ['/var/cache/pnpm'] } })
    const sandbox = settingsOf(posture).sandbox as { network: { allowedDomains: string[] }, filesystem: { allowWrite: string[] } }
    expect(sandbox.network.allowedDomains).toEqual(['git.example.com'])
    expect(sandbox.filesystem.allowWrite).toEqual(['/var/cache/pnpm'])
  })

  it('always allows bd, in every scope', () => {
    for (const scope of BOT_WRITE_SCOPES) {
      expect(flagValue(resolve('claude-code', scope), '--allowedTools'), scope).toBe(CLAUDE_BASELINE_ALLOWED_TOOLS.join(','))
    }
  })

  it('omits the system prompt flag when there are no surface instructions', () => {
    const posture = resolve('claude-code', 'read-only', { surfaceInstructions: undefined })
    expect(posture.flags).not.toContain('--append-system-prompt')
  })

  it('feeds the harness launcher as forwarded flags', () => {
    const posture = resolve('claude-code', 'read-only')
    const bins = { claudeShim: { command: '/usr/bin/node', args: ['/shim/cli.mjs'] } }
    const launch = resolveFamilyLaunch('claude-code', { configHome: '/homes/claude', flags: posture.flags, env: posture.env }, bins)
    expect(launch.args.slice(launch.args.indexOf('--') + 1)).toEqual(posture.flags)
  })
})

describe('resolveBotPosture for Codex', () => {
  it.each([
    ['read-only', 'read-only'],
    ['write-confirm', 'workspace-write'],
    ['write-auto', 'workspace-write'],
  ] as const)('maps %s to the %s mode with the persona as developer instructions', (scope, mode) => {
    const posture = resolve('codex', scope)
    expect(posture).toEqual({
      family: 'codex',
      writeScope: scope,
      flags: [],
      env: {},
      codex: { mode, developerInstructions: `${CODEX_PERSONA}\n\n${SURFACE}` },
      settingsOverrides: null,
      neutralised: [],
    })
  })

  it('feeds the harness launcher as codex options', () => {
    const posture = resolve('codex', 'write-auto')
    const bins = { codexAdapter: { command: '/usr/bin/node', args: ['/adapter/index.js'] } }
    const launch = resolveFamilyLaunch('codex', { configHome: '/homes/codex', flags: posture.flags, env: posture.env, codex: posture.codex }, bins)
    expect(launch.env.INITIAL_AGENT_MODE).toBe('workspace-write')
    expect(JSON.parse(launch.env.CODEX_CONFIG!)).toEqual({ developer_instructions: `${CODEX_PERSONA}\n\n${SURFACE}` })
  })

  it('gives the write scopes the main checkout\'s beads directory as a writable root and read-only none', () => {
    const beadsDir = '/work/alpha-main/.beads'
    expect(resolve('codex', 'write-confirm', { beadsDir }).codex).toMatchObject({ mode: 'workspace-write', writableRoots: [beadsDir] })
    expect(resolve('codex', 'write-auto', { beadsDir }).codex).toMatchObject({ mode: 'workspace-write', writableRoots: [beadsDir] })
    expect(resolve('codex', 'read-only', { beadsDir }).codex).toEqual({ mode: 'read-only', developerInstructions: `${CODEX_PERSONA}\n\n${SURFACE}` })
    expect(resolve('claude-code', 'write-auto', { beadsDir }).codex).toBeUndefined()
    expect(() => resolve('codex', 'write-auto', { beadsDir: 'alpha/.beads' })).toThrow(expect.objectContaining({ code: 'invalid_input' }))
  })

  it('launches a write scope with the beads directory in the sandbox config and as a session directory', () => {
    const beadsDir = '/work/alpha-main/.beads'
    const posture = resolve('codex', 'write-confirm', { beadsDir })
    const bins = { codexAdapter: { command: '/usr/bin/node', args: ['/adapter/index.js'] } }
    const launch = resolveFamilyLaunch('codex', { configHome: '/homes/codex', flags: posture.flags, env: posture.env, codex: posture.codex }, bins)
    expect(launch.env.INITIAL_AGENT_MODE).toBe('workspace-write')
    expect(JSON.parse(launch.env.CODEX_CONFIG!)).toEqual({ developer_instructions: `${CODEX_PERSONA}\n\n${SURFACE}`, sandbox_workspace_write: { writable_roots: [beadsDir] } })
    expect(launch.additionalDirectories).toEqual([beadsDir])
  })

  it('does not judge the Codex persona as front matter', () => {
    expect(resolve('codex', 'read-only', { personaText: '---\npermissionMode: bypassPermissions\n---\nhi' }).codex?.mode).toBe('read-only')
  })
})

describe('every scope and family passes the verifier', () => {
  it.each(BOT_FAMILIES.flatMap(family => BOT_WRITE_SCOPES.map(scope => [family, scope] as const)))('%s / %s', (family, scope) => {
    const posture = resolve(family, scope, { beadsDir: '/work/alpha/.beads' })
    expect(() => assertPostureNotWidened(posture, scope)).not.toThrow()
    // Codex has one mode for both write scopes, so only a scope with a different mapping can be told apart.
    const sameMapping = (other: BotWriteScope) => family === 'codex' && other !== 'read-only' && scope !== 'read-only'
    for (const other of BOT_WRITE_SCOPES.filter(s => s !== scope && !sameMapping(s))) {
      expect(() => assertPostureNotWidened(posture, other), `${scope} verified as ${other}`).toThrow(PostureError)
    }
  })
})

describe('persona front matter against the scope', () => {
  const persona = (lines: string[]) => ['---', 'name: pip', 'description: d', ...lines, '---', 'body'].join('\n')
  const claude = (scope: BotWriteScope, text: string) => () => resolve('claude-code', scope, { personaText: text })

  it('refuses a persona asking for a bypass', () => {
    expect(claude('write-auto', persona(['permissionMode: bypassPermissions']))).toThrow(expect.objectContaining({ code: 'bypass' }))
    expect(claude('write-auto', persona(['permissionMode: bypassPermissions']))).toThrow(/bypassPermissions/)
    expect(claude('write-auto', persona(['# run with --dangerously-skip-permissions']))).toThrow(expect.objectContaining({ code: 'bypass' }))
  })

  it('refuses a permission mode wider than the scope and allows one at or below it', () => {
    expect(claude('read-only', persona(['permissionMode: acceptEdits']))).toThrow(expect.objectContaining({ code: 'persona_widens' }))
    expect(claude('read-only', persona(['permissionMode: default']))).toThrow(/wider than the "plan"/)
    expect(claude('write-confirm', persona(['permissionMode: acceptEdits']))).toThrow(/wider than the "default"/)
    expect(claude('write-auto', persona(['permissionMode: auto']))).toThrow(/classifier/)
    expect(claude('write-auto', persona(['permissionMode: nonsense']))).toThrow(/does not define/)
    expect(claude('read-only', persona(['permissionMode: plan']))).not.toThrow()
    expect(claude('write-confirm', persona(['permissionMode: manual']))).not.toThrow()
    expect(claude('write-auto', persona(['permissionMode: "acceptEdits"']))).not.toThrow()
  })

  it('refuses tools the scope denies, in either list form', () => {
    expect(claude('read-only', persona(['tools: Read, ExitPlanMode']))).toThrow(/ExitPlanMode/)
    expect(claude('write-confirm', persona(['tools:', '  - Read', '  - Agent']))).toThrow(/Agent tool/)
    expect(claude('write-confirm', persona(['tools: [Read, Workflow]']))).toThrow(/Workflow/)
    expect(claude('write-auto', persona(['tools: Read, Agent, Workflow']))).not.toThrow()
    expect(claude('read-only', persona(['tools: Read, Edit, Bash']))).not.toThrow()
  })

  it('refuses hooks, MCP servers, an observer and out-of-scope memory', () => {
    expect(claude('write-auto', persona(['hooks:', '  PreToolUse: []']))).toThrow(/hooks/)
    expect(claude('write-auto', persona(['mcpServers:', '  - fetch']))).toThrow(/mcpServers/)
    expect(claude('write-auto', persona(['observer: watcher']))).toThrow(/observer/)
    expect(claude('write-auto', persona(['memory: user']))).toThrow(/outside the checkout/)
    expect(claude('write-confirm', persona(['memory: project']))).toThrow(/memory "project"/)
    expect(claude('write-auto', persona(['memory: project']))).not.toThrow()
  })

  it('refuses a persona claude --agent would not load', () => {
    expect(claude('read-only', 'You are Pip, with no front matter.')).toThrow(expect.objectContaining({ code: 'persona_unreadable' }))
    expect(claude('read-only', '---\ndescription: d\n---\nbody')).toThrow(/no name/)
    expect(claude('read-only', '---\nname: other\n---\nbody')).toThrow(expect.objectContaining({ code: 'persona_name_mismatch' }))
    expect(claude('read-only', '---\nname: pip\n{ permissionMode: acceptEdits }\n---\nbody')).toThrow(/not a plain "key: value"/)
    expect(claude('read-only', '---\nname: pip\nno closing fence')).toThrow(expect.objectContaining({ code: 'persona_unreadable' }))
    expect(claude('read-only', '   \n')).toThrow(/empty/)
  })
})

describe('checkout settings vetting', () => {
  const file = (settings: Record<string, unknown>, name = '.claude/settings.json') => ({ path: join(CHECKOUT, name), settings })

  it('neutralises allow rules by mirroring them as ask rules in the override', () => {
    const posture = resolve('claude-code', 'write-confirm', { checkoutSettings: [file({ permissions: { allow: ['Bash(npm test *)', 'Bash(rm -rf *)'] } })] })
    const permissions = settingsOf(posture).permissions as { ask: string[] }
    expect(permissions.ask).toEqual(['Bash(npm test *)', 'Bash(rm -rf *)'])
    expect(posture.neutralised.map(n => n.key)).toEqual(['permissions.allow Bash(npm test *)', 'permissions.allow Bash(rm -rf *)'])
    expect(posture.neutralised[0]!.file).toBe(join(CHECKOUT, '.claude/settings.json'))
  })

  it('neutralises a blanket shell allow and says bd will prompt there', () => {
    const posture = resolve('claude-code', 'write-auto', { checkoutSettings: [file({ permissions: { allow: ['Bash'] } }, '.claude/settings.local.json')] })
    const permissions = settingsOf(posture).permissions as { ask: string[] }
    expect(permissions.ask).toEqual([...CLAUDE_PUSH_ASK_RULES, 'Bash'])
    expect(posture.neutralised[0]!.how).toMatch(/bd will prompt/)
    expect(flagValue(posture, '--allowedTools')).toBe('Bash(bd *)')
  })

  it('leaves the checkout allowing bd itself alone', () => {
    const posture = resolve('claude-code', 'read-only', { checkoutSettings: [file({ permissions: { allow: ['Bash(bd *)', 'Bash(bd:*)'] } })] })
    expect((settingsOf(posture).permissions as Record<string, unknown>).ask).toBeUndefined()
    expect(posture.neutralised).toEqual([])
  })

  it('denies edits in additional directories the checkout opens', () => {
    const posture = resolve('claude-code', 'write-auto', { checkoutSettings: [file({ permissions: { additionalDirectories: ['../shared', '/srv/data', '~/notes'] } })] })
    const permissions = settingsOf(posture).permissions as { deny: string[] }
    expect(permissions.deny).toEqual(['Edit(//work/shared/**)', 'Edit(//srv/data/**)', 'Edit(~/notes/**)'])
  })

  it('reports hooks, mode, sandbox, agent and MCP keys with the mechanism that outranks each', () => {
    const settings = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo allow' }] }] }, permissions: { defaultMode: 'bypassPermissions' }, sandbox: { enabled: true, autoAllowBashIfSandboxed: true }, agent: 'other', enableAllProjectMcpServers: true }
    for (const scope of BOT_WRITE_SCOPES) {
      const posture = resolve('claude-code', scope, { checkoutSettings: [file(settings)] })
      expect(posture.neutralised.map(n => n.key).sort()).toEqual(['agent', 'enableAllProjectMcpServers', 'hooks', 'permissions.defaultMode', 'sandbox'])
      expect(settingsOf(posture).disableAllHooks).toBe(true)
    }
    expect(resolve('claude-code', 'write-auto', { checkoutSettings: [file(settings)] }).neutralised.find(n => n.key === 'sandbox')!.how).toMatch(/allowUnsandboxedCommands/)
    expect(resolve('claude-code', 'read-only', { checkoutSettings: [file(settings)] }).neutralised.find(n => n.key === 'sandbox')!.how).toMatch(/sandbox.enabled: false/)
  })

  it('refuses settings it cannot judge', () => {
    expect(() => resolve('claude-code', 'read-only', { checkoutSettings: [file({ permissions: 'yes' })] })).toThrow(expect.objectContaining({ code: 'checkout_settings_unreadable' }))
    expect(() => resolve('claude-code', 'read-only', { checkoutSettings: [file({ permissions: { allow: 'Bash' } })] })).toThrow(/other than a list/)
    expect(() => resolve('claude-code', 'read-only', { checkoutSettings: [file({ permissions: { allow: [1] } })] })).toThrow(/not a string/)
  })

  it('ignores checkout settings for Codex', () => {
    expect(resolve('codex', 'read-only', { checkoutSettings: [file({ permissions: { allow: ['Bash'] } })] }).neutralised).toEqual([])
  })
})

describe('reading the checkout settings from disk', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads both files and skips missing ones', () => {
    dir = mkdtempSync(join(tmpdir(), 'posture-'))
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(make *)'] } }))
    const posture = resolve('claude-code', 'read-only', { checkoutDir: dir, checkoutSettings: undefined })
    expect((settingsOf(posture).permissions as { ask: string[] }).ask).toEqual(['Bash(make *)'])
    expect(posture.neutralised[0]!.file).toBe(join(dir, '.claude/settings.json'))
    expect(resolve('claude-code', 'read-only', { checkoutDir: join(dir, 'missing'), checkoutSettings: undefined }).neutralised).toEqual([])
  })

  it('refuses a file that is not a JSON object', () => {
    dir = mkdtempSync(join(tmpdir(), 'posture-'))
    mkdirSync(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude/settings.local.json'), '{ not json')
    expect(() => resolve('claude-code', 'read-only', { checkoutDir: dir, checkoutSettings: undefined })).toThrow(expect.objectContaining({ code: 'checkout_settings_unreadable' }))
  })
})

describe('input validation', () => {
  it('refuses unknown families, scopes, bad persona names and relative checkouts', () => {
    expect(() => resolve('gemini' as BotFamily, 'read-only')).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    expect(() => resolve('claude-code', 'yolo' as BotWriteScope)).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    expect(() => resolve('claude-code', 'read-only', { personaName: '../pip' })).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    expect(() => resolve('claude-code', 'read-only', { personaName: '--agent' })).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    expect(() => resolve('claude-code', 'read-only', { checkoutDir: 'relative' })).toThrow(expect.objectContaining({ code: 'invalid_input' }))
  })
})
