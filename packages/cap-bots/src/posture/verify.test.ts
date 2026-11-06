import { describe, expect, it } from 'vitest'
import { PostureError } from './errors'
import { assertPostureNotWidened, resolveBotPosture, type BotPosture } from './index'

const PERSONA = '---\nname: pip\ndescription: d\n---\nbody'

function base(scope: 'read-only' | 'write-confirm' | 'write-auto' = 'write-confirm'): BotPosture {
  return resolveBotPosture({ family: 'claude-code', writeScope: scope, personaName: 'pip', personaText: PERSONA, checkoutDir: '/work/alpha', checkoutSettings: [] })
}

function withFlags(posture: BotPosture, edit: (flags: string[]) => string[]): BotPosture {
  return { ...posture, flags: edit([...posture.flags]) }
}

function withSettings(posture: BotPosture, edit: (settings: Record<string, unknown>) => void): BotPosture {
  const settings = structuredClone(posture.settingsOverrides!)
  edit(settings)
  const flags = [...posture.flags]
  flags[flags.indexOf('--settings') + 1] = JSON.stringify(settings)
  return { ...posture, flags, settingsOverrides: settings }
}

const refuses = (posture: BotPosture, pattern: RegExp, scope: BotPosture['writeScope'] = posture.writeScope) => {
  expect(() => assertPostureNotWidened(posture, scope)).toThrow(PostureError)
  expect(() => assertPostureNotWidened(posture, scope)).toThrow(pattern)
}

describe('assertPostureNotWidened for Claude Code', () => {
  it('refuses bypass flags and modes wherever they appear', () => {
    refuses(withFlags(base(), f => [...f, '--dangerously-skip-permissions']), /bypass/)
    refuses(withFlags(base(), f => [...f, '--allow-dangerously-skip-permissions']), /bypass/)
    refuses(withFlags(base(), f => { f[f.indexOf('--permission-mode') + 1] = 'bypassPermissions'; return f }), /bypass/)
    refuses(withFlags(base(), f => { f[f.indexOf('--permission-mode') + 1] = 'auto'; return f }), /--permission-mode must be exactly "default"/)
    refuses(withFlags(base(), f => [...f, '--permission-mode', 'acceptEdits']), /exactly "default"/)
    refuses(withFlags(base(), f => f.filter(x => x !== '--permission-mode' && x !== 'default')), /exactly "default"/)
    refuses({ ...base(), env: { CLAUDE_CODE_FLAGS: '--yolo' } }, /bypass/)
  })

  it('refuses flags that route around the posture', () => {
    for (const flag of ['--setting-sources user', '--bare', '--permission-prompt-tool stdio', '--system-prompt x', '--agents {}', '--tools Bash', '--add-dir /etc', '--mcp-config x.json', '--permission-prompts none']) {
      refuses(withFlags(base(), f => [...f, ...flag.split(' ')]), new RegExp(flag.split(' ')[0]!.replace(/-/g, '\\-')))
    }
    refuses(withFlags(base(), f => f.filter(x => x !== '--strict-mcp-config')), /strict-mcp-config/)
  })

  it('refuses a settings override that drops a guard', () => {
    refuses(withSettings(base(), s => { s.disableAllHooks = false }), /disableAllHooks/)
    refuses(withSettings(base(), s => { delete s.disableAllHooks }), /disableAllHooks/)
    refuses(withSettings(base(), s => { (s.permissions as Record<string, unknown>).disableBypassPermissionsMode = 'enable' }), /disableBypassPermissionsMode/)
    refuses(withSettings(base(), s => { (s.permissions as Record<string, unknown>).disableAutoMode = undefined }), /disableAutoMode/)
    refuses(withSettings(base(), s => { (s.permissions as Record<string, unknown>).defaultMode = 'acceptEdits' }), /defaultMode/)
    refuses(withSettings(base(), s => { (s.permissions as Record<string, unknown>).allow = ['Bash'] }), /allow rules/)
    refuses(withSettings(base(), s => { (s.permissions as Record<string, unknown>).additionalDirectories = ['/'] }), /directories/)
    refuses(withSettings(base(), s => { s.hooks = { PreToolUse: [] } }), /hooks/)
    refuses(withSettings(base(), s => { s.apiKeyHelper = 'cat key' }), /authentication/)
    refuses(withSettings(base(), s => { s.enableAllProjectMcpServers = true }), /enableAllProjectMcpServers/)
    refuses(withSettings(base(), s => { s.sandbox = { enabled: true, autoAllowBashIfSandboxed: true } }), /sandbox off/)
    refuses(withSettings(base('read-only'), s => { delete s.useAutoModeDuringPlan }), /useAutoModeDuringPlan/)
    refuses(withSettings(base('write-auto'), s => { (s.sandbox as Record<string, unknown>).allowUnsandboxedCommands = true }), /unsandboxed/)
    refuses(withSettings(base('write-auto'), s => { (s.sandbox as Record<string, unknown>).enabled = false }), /sandbox on/)
    refuses(withSettings(base('write-auto'), s => { (s.permissions as Record<string, unknown>).ask = [] }), /git push/)
  })

  it('refuses a settings flag that cannot be read or does not match the object', () => {
    refuses(withFlags(base(), f => { f[f.indexOf('--settings') + 1] = '/etc/claude/settings.json'; return f }), /inline JSON/)
    refuses({ ...base(), settingsOverrides: { disableAllHooks: true } }, /does not match/)
    refuses(withFlags(base(), f => f.filter(x => x !== '--settings' && !x.startsWith('{'))), /Exactly one --settings/)
  })

  it('refuses allow lists wider than bd and missing denials', () => {
    const allow = (value: string) => withFlags(base(), f => { f[f.indexOf('--allowedTools') + 1] = value; return f })
    refuses(allow('Bash(bd *),Edit'), /editing tool/)
    refuses(allow('Bash(bd *),Write(*)'), /editing tool/)
    refuses(allow('Bash(bd *),Bash'), /blanket shell/)
    refuses(allow('Bash(bd *),Bash(*)'), /blanket shell/)
    refuses(allow('Bash(bd *),*'), /wildcard/)
    refuses(allow('Bash(git status *)'), /bd \*\) must always be allowed/)
    refuses(withFlags(base('read-only'), f => { f[f.indexOf('--disallowedTools') + 1] = 'Agent,Workflow'; return f }), /ExitPlanMode must be denied/)
    refuses(withFlags(base('write-confirm'), f => f.filter(x => x !== '--disallowedTools' && x !== 'Agent,Workflow')), /Agent must be denied/)
    expect(() => assertPostureNotWidened(allow('Bash(bd *),Bash(git status *)'), 'write-confirm')).not.toThrow()
  })

  it('refuses a missing persona and instruction text the CLI would read as a flag', () => {
    refuses(withFlags(base(), f => f.filter(x => x !== '--agent' && x !== 'pip')), /--agent/)
    refuses(withFlags(base(), f => [...f, '--append-system-prompt', '-p rest of the text']), /start with "-"/)
    expect(() => assertPostureNotWidened(withFlags(base(), f => [...f, '--append-system-prompt', 'mention bypassPermissions in prose']), 'write-confirm')).not.toThrow()
  })
})

describe('assertPostureNotWidened for Codex', () => {
  const codex = (): BotPosture => resolveBotPosture({ family: 'codex', writeScope: 'read-only', personaName: 'pip', personaText: 'Pip', checkoutDir: '/work/alpha' })

  it('refuses any mode outside the launcher table and the wrong mode for the scope', () => {
    refuses({ ...codex(), codex: { mode: 'agent' as 'read-only' } }, /not one of/)
    refuses({ ...codex(), codex: { mode: 'agent-full-access' as 'read-only' } }, /not one of/)
    refuses({ ...codex(), codex: {} }, /not one of/)
    refuses({ ...codex(), codex: { mode: 'workspace-write' } }, /must be "read-only"/)
    refuses(codex(), /must be "workspace-write"/, 'write-auto')
  })

  it('refuses flags, launcher variables and unknown options', () => {
    refuses({ ...codex(), flags: ['cli', '--dangerously-bypass-approvals-and-sandbox'] }, /no flags/)
    refuses({ ...codex(), env: { INITIAL_AGENT_MODE: 'agent' } }, /INITIAL_AGENT_MODE/)
    refuses({ ...codex(), env: { CODEX_CONFIG: '{"approvals_reviewer":"auto_review"}' } }, /CODEX_CONFIG/)
    refuses({ ...codex(), env: { EXTRA: '--yolo' } }, /bypass/)
    refuses({ ...codex(), codex: { mode: 'read-only', config: {} } as BotPosture['codex'] }, /Unknown Codex options/)
  })

  it('allows writable roots only for the write scopes and only as an absolute .beads directory', () => {
    const write = (writableRoots: unknown): BotPosture => ({ ...codex(), writeScope: 'write-confirm', codex: { mode: 'workspace-write', writableRoots: writableRoots as string[] } })
    for (const scope of ['write-confirm', 'write-auto'] as const) {
      expect(() => assertPostureNotWidened(write(['/work/alpha/.beads']), scope)).not.toThrow()
    }
    refuses({ ...codex(), codex: { mode: 'read-only', writableRoots: ['/work/alpha/.beads'] } }, /refused for the read-only scope/)
    refuses({ ...codex(), codex: { mode: 'read-only', writableRoots: [] } }, /refused for the read-only scope/)
    refuses(write([]), /non-empty/)
    refuses(write('/work/alpha/.beads'), /non-empty list/)
    refuses(write(['work/alpha/.beads']), /absolute \.beads/)
    refuses(write(['/work/alpha/.beads/../../etc/.beads/..']), /absolute \.beads/)
    refuses(write(['/']), /absolute \.beads/)
    refuses(write(['/home/jack']), /absolute \.beads/)
    refuses(write(['/work/alpha/.beads', 7]), /absolute \.beads/)
  })
})
