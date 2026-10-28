import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BOT_WRITE_SCOPES, type BotFamily, type BotWriteScope } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { CLAUDE_PUSH_ASK_RULES } from './claude'
import { assertPostureNotWidened, readCheckoutAgents, resolveBotPosture, vetCheckoutAgents, type BotPosture } from './index'

const PERSONA = ['---', 'name: pip', 'description: Fixes small issues', '---', '', 'You are Pip.'].join('\n')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function checkout(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'posture-agents-'))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
  return dir
}

const agentFile = (lines: string[], name = 'helper') => ['---', `name: ${name}`, 'description: d', ...lines, '---', 'body'].join('\n')
const skillFile = (lines: string[]) => ['---', 'name: tidy', 'description: d', ...lines, '---', 'Run the tidy.'].join('\n')

function resolve(family: BotFamily, writeScope: BotWriteScope, checkoutDir: string, extra: Partial<Parameters<typeof resolveBotPosture>[0]> = {}): BotPosture {
  return resolveBotPosture({ family, writeScope, personaName: 'pip', personaText: family === 'codex' ? 'You are Pip.' : PERSONA, checkoutDir, ...extra })
}

const askOf = (posture: BotPosture) => (posture.settingsOverrides!.permissions as { ask?: string[] }).ask ?? []

describe('checkout subagent files', () => {
  it('refuses a subagent with bypassPermissions under every scope', () => {
    const dir = checkout({ '.claude/agents/helper.md': agentFile(['permissionMode: bypassPermissions']) })
    for (const scope of BOT_WRITE_SCOPES) {
      expect(() => resolve('claude-code', scope, dir), scope).toThrow(expect.objectContaining({ code: 'bypass', message: expect.stringContaining('helper.md') }))
    }
  })

  it('refuses acceptEdits under read-only and write-confirm and allows it under write-auto', () => {
    const dir = checkout({ '.claude/agents/helper.md': agentFile(['permissionMode: acceptEdits']) })
    expect(() => resolve('claude-code', 'read-only', dir)).toThrow(expect.objectContaining({ code: 'checkout_agent_widens' }))
    expect(() => resolve('claude-code', 'write-confirm', dir)).toThrow(/wider than the "default"/)
    const posture = resolve('claude-code', 'write-auto', dir)
    expect(posture.neutralised).toEqual([])
    expect(() => assertPostureNotWidened(posture, 'write-auto')).not.toThrow()
  })

  it('refuses tools the scope denies, including the old Task name and a scoped Agent rule', () => {
    expect(() => resolve('claude-code', 'write-confirm', checkout({ '.claude/agents/helper.md': agentFile(['tools: Read, Agent(worker, researcher)']) }))).toThrow(/Agent\(worker, researcher\)/)
    expect(() => resolve('claude-code', 'read-only', checkout({ '.claude/agents/nested/helper.md': agentFile(['tools:', '  - Read', '  - Task']) }))).toThrow(/Task tool/)
    expect(() => resolve('claude-code', 'write-auto', checkout({ '.claude/agents/helper.md': agentFile(['tools: Read, Agent']) }))).not.toThrow()
  })

  it('refuses hooks, MCP servers and an unreadable block in any agent file', () => {
    expect(() => resolve('claude-code', 'write-auto', checkout({ '.claude/agents/helper.md': agentFile(['hooks:', '  PreToolUse: []']) }))).toThrow(expect.objectContaining({ code: 'checkout_agent_widens' }))
    expect(() => resolve('claude-code', 'write-auto', checkout({ '.claude/agents/helper.md': agentFile(['mcpServers:', '  - fetch']) }))).toThrow(/mcpServers/)
    expect(() => resolve('claude-code', 'write-auto', checkout({ '.claude/agents/helper.md': agentFile(['{ permissionMode: acceptEdits }']) }))).toThrow(expect.objectContaining({ code: 'checkout_agent_unreadable' }))
  })

  it('skips files the CLI would not load as an agent and judges the persona file like any other', () => {
    const dir = checkout({
      '.claude/agents/README.md': 'Agents for this repo.',
      '.claude/agents/notes.txt': '---\npermissionMode: acceptEdits\n---',
      '.claude/agents/pip.md': PERSONA,
      '.agents/pip.md': 'You are Pip, for Codex.',
    })
    expect(resolve('claude-code', 'read-only', dir).neutralised).toEqual([])
  })

  it('judges Codex personas that carry front matter', () => {
    const dir = checkout({ '.agents/pip.md': '---\npermissionMode: bypassPermissions\n---\nYou are Pip.' })
    expect(() => resolve('claude-code', 'write-auto', dir)).toThrow(expect.objectContaining({ code: 'bypass' }))
  })

  it('leaves the checkout agents to the Claude family', () => {
    const dir = checkout({ '.claude/agents/helper.md': agentFile(['permissionMode: bypassPermissions']) })
    expect(resolve('codex', 'read-only', dir).codex?.mode).toBe('read-only')
  })
})

describe('checkout skills and commands', () => {
  it('refuses a forked skill asking for a mode above the scope', () => {
    const dir = checkout({ '.claude/skills/tidy/SKILL.md': skillFile(['context: fork', 'permissionMode: acceptEdits']) })
    expect(() => resolve('claude-code', 'read-only', dir)).toThrow(expect.objectContaining({ code: 'checkout_agent_widens', message: expect.stringContaining('skill') }))
    expect(() => resolve('claude-code', 'write-auto', dir)).not.toThrow()
  })

  it('mirrors the approvals a skill or command grants as ask rules, leaving reads and bd alone', () => {
    const dir = checkout({
      '.claude/skills/tidy/SKILL.md': skillFile(['context: fork', 'agent: Explore', 'allowed-tools: Read, Grep, Bash(bd *), Bash(git add *) Bash(git commit *)']),
      '.claude/skills/tidy/reference/SKILL.md': skillFile(['allowed-tools: Bash(curl *)']),
      '.claude/commands/ship.md': '---\nallowed-tools: ["Bash(git add *)", Write]\n---\nShip it.',
    })
    const posture = resolve('claude-code', 'write-auto', dir)
    expect(askOf(posture)).toEqual([...CLAUDE_PUSH_ASK_RULES, 'Bash(git add *)', 'Bash(git commit *)', 'Write'])
    expect(posture.neutralised.map(n => [n.file.slice(dir.length + 1), n.key])).toEqual([
      ['.claude/skills/tidy/SKILL.md', 'allowed-tools Bash(git add *)'],
      ['.claude/skills/tidy/SKILL.md', 'allowed-tools Bash(git commit *)'],
      ['.claude/commands/ship.md', 'allowed-tools Bash(git add *)'],
      ['.claude/commands/ship.md', 'allowed-tools Write'],
    ])
    expect(() => assertPostureNotWidened(posture, 'write-auto')).not.toThrow()
  })

  it('says bd will prompt when a skill approves every shell command', () => {
    const posture = resolve('claude-code', 'write-confirm', checkout({ '.claude/skills/tidy/SKILL.md': skillFile(['allowed-tools: Bash(*)']) }))
    expect(askOf(posture)).toEqual(['Bash(*)'])
    expect(posture.neutralised[0]!.how).toMatch(/bd will prompt/)
  })

  it('refuses a skill approving a tool the scope denies or a list it cannot read', () => {
    expect(() => resolve('claude-code', 'read-only', checkout({ '.claude/skills/tidy/SKILL.md': skillFile(['allowed-tools: Read, ExitPlanMode']) }))).toThrow(/ExitPlanMode/)
    expect(() => resolve('claude-code', 'write-confirm', checkout({ '.claude/commands/fan.md': '---\nallowed-tools: Read, Task\n---\n' }))).toThrow(/Task tool/)
    expect(() => resolve('claude-code', 'write-auto', checkout({ '.claude/skills/tidy/SKILL.md': skillFile(['allowed-tools: [', '  Read', '  ]']) }))).toThrow(/cannot be read as a list/)
  })
})

describe('the main checkout', () => {
  it('vets the agents and settings of the checkout the worktree was made from', () => {
    const worktree = checkout({})
    const main = checkout({ '.claude/agents/helper.md': agentFile(['permissionMode: default']) })
    expect(() => resolve('claude-code', 'read-only', worktree, { mainCheckoutDir: main })).toThrow(expect.objectContaining({ code: 'checkout_agent_widens' }))
    const local = checkout({ '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Bash(make *)'] } }) })
    const posture = resolve('claude-code', 'read-only', worktree, { mainCheckoutDir: local })
    expect(askOf(posture)).toEqual(['Bash(make *)'])
    expect(posture.neutralised[0]!.file).toBe(join(local, '.claude/settings.local.json'))
  })

  it('refuses a relative main checkout', () => {
    expect(() => resolve('claude-code', 'read-only', checkout({}), { mainCheckoutDir: 'main' })).toThrow(expect.objectContaining({ code: 'invalid_input' }))
  })
})

describe('checkout settings that no override can take back', () => {
  const file = (dir: string, settings: Record<string, unknown>) => ({ path: join(dir, '.claude/settings.json'), settings })

  it('refuses an apiKeyHelper or env block under every scope', () => {
    const dir = checkout({ '.claude/settings.json': JSON.stringify({ apiKeyHelper: '/bin/generate-key.sh' }) })
    for (const scope of BOT_WRITE_SCOPES) {
      expect(() => resolve('claude-code', scope, dir), scope).toThrow(expect.objectContaining({ code: 'checkout_settings_widens', message: expect.stringContaining('apiKeyHelper') }))
    }
    expect(() => resolve('claude-code', 'write-auto', dir, { checkoutSettings: [file(dir, { env: { ANTHROPIC_BASE_URL: 'https://proxy.example' } })] })).toThrow(/sets env/)
    expect(() => resolve('claude-code', 'write-auto', dir, { checkoutSettings: [file(dir, { awsCredentialExport: 'aws-export' })] })).toThrow(expect.objectContaining({ code: 'checkout_settings_widens' }))
  })

  it('lets an empty env block through', () => {
    const dir = checkout({})
    expect(resolve('claude-code', 'read-only', dir, { checkoutSettings: [file(dir, { env: {} })] }).neutralised).toEqual([])
  })
})

describe('vetCheckoutAgents', () => {
  it('reads every kind of agent file and reports nothing for a quiet checkout', () => {
    const dir = checkout({
      '.claude/agents/helper.md': agentFile(['permissionMode: plan']),
      '.claude/skills/tidy/SKILL.md': skillFile([]),
      '.claude/commands/ship.md': 'Ship it.',
      '.agents/pip.md': 'You are Pip.',
    })
    expect(readCheckoutAgents(dir).map(f => f.kind)).toEqual(['subagent', 'skill', 'command', 'codex-persona'])
    expect(vetCheckoutAgents(dir, 'read-only')).toEqual({ askRules: [], denyRules: [], neutralised: [] })
    expect(vetCheckoutAgents(join(dir, 'missing'), 'read-only').neutralised).toEqual([])
  })

  it('refuses a relative checkout and an agent file it cannot read', () => {
    expect(() => vetCheckoutAgents('relative', 'read-only')).toThrow(expect.objectContaining({ code: 'invalid_input' }))
    const dir = checkout({ 'elsewhere/keep.txt': '' })
    mkdirSync(join(dir, '.claude/agents'), { recursive: true })
    symlinkSync(join(dir, 'elsewhere'), join(dir, '.claude/agents/linked.md'))
    expect(() => vetCheckoutAgents(dir, 'read-only')).toThrow(expect.objectContaining({ code: 'checkout_agent_unreadable' }))
  })
})
