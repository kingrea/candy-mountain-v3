import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { BotWriteScope } from '@candy-mountain/shared'
import { mirrorAllowAsAsk, type CheckoutVetting } from './checkout-settings'
import { PostureError } from './errors'
import { assertFrontMatterWithinScope, frontMatterList, parsePersonaFrontMatter, toolName } from './front-matter'
import { findBypassToken } from './tokens'

export type CheckoutAgentKind = 'subagent' | 'skill' | 'command' | 'codex-persona'

export interface CheckoutAgentFile {
  path: string
  kind: CheckoutAgentKind
  text: string
}

/** Tools that only read or ask the person; approving them up front widens no write scope, and an ask rule would stall every read. */
export const CLAUDE_UNPROMPTED_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoWrite', 'AskUserQuestion'] as const

const APPROVING_KEYS = new Set(['allowed-tools', 'allowedTools'])

function unreadable(path: string, code: string | undefined): PostureError {
  return new PostureError('checkout_agent_unreadable', `${path} cannot be read (${code ?? 'unknown error'}), so what it asks for cannot be judged`)
}

function filesUnder(dir: string, recursive: boolean): string[] {
  try {
    return readdirSync(dir, { recursive, withFileTypes: true })
      .filter(entry => !entry.isDirectory())
      .map(entry => join(entry.parentPath, entry.name))
      .sort()
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw unreadable(dir, code)
  }
}

/** Every file the CLI could load as a subagent, skill or command, plus the Codex personas, read whole; missing directories are skipped. */
export function readCheckoutAgents(checkoutDir: string): CheckoutAgentFile[] {
  if (!isAbsolute(checkoutDir)) throw new PostureError('invalid_input', 'checkoutDir must be an absolute path')
  const skills = join(checkoutDir, '.claude/skills')
  const isMarkdown = (path: string) => path.endsWith('.md')
  const found: [CheckoutAgentKind, string[]][] = [
    ['subagent', filesUnder(join(checkoutDir, '.claude/agents'), true).filter(isMarkdown)],
    ['skill', filesUnder(skills, true).filter(path => basename(path) === 'SKILL.md' && dirname(dirname(path)) === skills)],
    ['command', filesUnder(join(checkoutDir, '.claude/commands'), true).filter(isMarkdown)],
    ['codex-persona', filesUnder(join(checkoutDir, '.agents'), false).filter(isMarkdown)],
  ]
  return found.flatMap(([kind, paths]) => paths.map((path) => {
    try {
      return { path, kind, text: readFileSync(path, 'utf8') }
    }
    catch (error) {
      throw unreadable(path, (error as NodeJS.ErrnoException).code)
    }
  }))
}

/**
 * Holds every agent file in the checkout to the persona's ceiling: with the Agent tool denied a forked skill can still
 * start a subagent, which runs in its own front-matter permissionMode. Approvals a skill or command grants become ask rules.
 */
export function vetCheckoutAgents(checkoutDir: string, writeScope: BotWriteScope): CheckoutVetting {
  const vetting: CheckoutVetting = { askRules: [], denyRules: [], neutralised: [] }
  for (const file of readCheckoutAgents(checkoutDir)) {
    const front = parsePersonaFrontMatter(file.text)
    if (!front) continue
    const at = `Checkout ${file.kind} ${file.path}`
    const token = findBypassToken(front.block)
    if (token) throw new PostureError('bypass', `${at} asks for a blanket permission bypass in its front matter: ${token}`)
    if (front.unreadable) throw new PostureError('checkout_agent_unreadable', `${at} ${front.unreadable}`)
    assertFrontMatterWithinScope(at, front, writeScope, 'checkout_agent_widens')
    for (const entry of front.entries.filter(e => APPROVING_KEYS.has(e.key))) {
      for (const rule of frontMatterList(entry) ?? []) {
        if (!(CLAUDE_UNPROMPTED_TOOLS as readonly string[]).includes(toolName(rule))) mirrorAllowAsAsk(vetting, file.path, entry.key, rule)
      }
    }
  }
  return vetting
}
