import type { BotWriteScope } from '@candy-mountain/shared'
import { CLAUDE_DENIED_TOOLS, CLAUDE_PERMISSION_MODES } from './claude'
import { PostureError } from './errors'
import { findBypassToken } from './tokens'

export interface FrontMatterEntry {
  key: string
  /** Text after the colon on the key's own line, trimmed; empty for a block value. */
  value: string
  items: string[]
}

export interface PersonaFrontMatter {
  block: string
  entries: FrontMatterEntry[]
  /** Why the block holds a line the judge cannot read as a plain top-level entry, or null. */
  unreadable: string | null
}

const TOP_LEVEL_KEY = /^(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/
const SEQUENCE_ITEM = /^[ \t]*-[ \t]+(.*?)[ \t]*$/

/**
 * Only plain top-level `key: value` lines and their block sequences are read; a flow mapping, merge key or
 * other shape the CLI's YAML parser would still accept is marked unreadable so a key cannot hide from the judge.
 */
export function parsePersonaFrontMatter(text: string): PersonaFrontMatter | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const entries: FrontMatterEntry[] = []
  let unreadable: string | null = null
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!
    if (line.trim() === '---') return { block: lines.slice(1, index).join('\n'), entries, unreadable }
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const item = SEQUENCE_ITEM.exec(line)
    if (item) {
      const last = entries.at(-1)
      if (last && !last.value) last.items.push(item[1]!)
      else unreadable ??= `front matter line ${index + 1} is a sequence item without a key`
      continue
    }
    if (/^[ \t]/.test(line)) continue
    const match = TOP_LEVEL_KEY.exec(line)
    if (match) entries.push({ key: match[2]!, value: match[3] ?? '', items: [] })
    else unreadable ??= `front matter line ${index + 1} is not a plain "key: value" line`
  }
  return null
}

/** A plain or quoted one-line scalar with a trailing comment removed; null for anchors, tags, block indicators and the like. */
export function frontMatterScalar(value: string): string | null {
  const quoted = /^(["'])(.*)\1(?:[ \t]+#.*)?$/.exec(value)
  if (quoted) return quoted[2]!
  const plain = value.replace(/[ \t]+#.*$/, '').trim()
  if (!plain || /^[&*!|>{[@`%"']/.test(plain)) return null
  return plain
}

/** Splits on commas and whitespace outside parentheses, so `Bash(git add *) Read` and `Agent(a, b)` keep their rules whole. */
function splitToolList(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const char of text) {
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current) parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) parts.push(current)
  return parts.map(part => part.replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean)
}

/** The CLI accepts `tools: A, B`, `allowed-tools: A B` and a block sequence; a flow sequence `[A, B]` is read too. */
export function frontMatterList(entry: FrontMatterEntry): string[] | null {
  if (entry.items.length) return entry.value ? null : entry.items.map(item => frontMatterScalar(item) ?? '').filter(Boolean)
  const flow = /^\[(.*)\]$/.exec(entry.value.trim())
  const scalar = flow ? flow[1]! : frontMatterScalar(entry.value)
  if (scalar === null) return null
  return splitToolList(scalar)
}

export function frontMatterName(front: PersonaFrontMatter): string | null {
  const entry = front.entries.find(e => e.key === 'name')
  return entry ? frontMatterScalar(entry.value) : null
}

/** The CLI's widening order; `manual` is an alias of `default`. */
export const CLAUDE_MODE_RANK: Readonly<Record<string, number>> = {
  plan: 0,
  default: 1,
  manual: 1,
  dontAsk: 1,
  acceptEdits: 2,
  auto: 3,
  bypassPermissions: 4,
}

/** Keys the persona may not set under any scope: each runs or approves something with nobody asked. */
export const PERSONA_REFUSED_KEYS: Readonly<Record<string, string>> = {
  hooks: 'a PreToolUse hook can answer a permission request itself',
  mcpServers: 'the CLI starts each server command at launch with no approval',
  observer: 'the agent it names runs in the background in its own permission mode',
}

const MEMORY_SCOPES_IN_CHECKOUT = new Set(['project', 'local'])

/** `tools` limits what a subagent may call; `allowed-tools` (a skill or command) approves calls without asking. */
export const TOOL_LIST_KEYS: ReadonlySet<string> = new Set(['tools', 'allowed-tools', 'allowedTools'])

/** The CLI still accepts the subagent tool's old name. */
const TOOL_ALIASES: Readonly<Record<string, string>> = { Task: 'Agent' }

export function toolName(rule: string): string {
  const name = rule.replace(/\(.*$/, '').trim()
  return TOOL_ALIASES[name] ?? name
}

/**
 * The ceiling every agent file in the checkout is held to: no permissionMode above the scope's, no tool the scope
 * denies, and none of the keys that run or approve something with nobody asked.
 */
export function assertFrontMatterWithinScope(at: string, front: PersonaFrontMatter, writeScope: BotWriteScope, code: 'persona_widens' | 'checkout_agent_widens'): void {
  const ceiling = CLAUDE_PERMISSION_MODES[writeScope]
  const denied = CLAUDE_DENIED_TOOLS[writeScope]
  const widens = (detail: string) => new PostureError(code, `${at} ${detail}; it may not ask for more than the "${writeScope}" write scope allows`)
  for (const entry of front.entries) {
    const refused = PERSONA_REFUSED_KEYS[entry.key]
    if (refused) throw widens(`sets ${entry.key}: ${refused}`)
    if (entry.key === 'permissionMode') {
      const mode = frontMatterScalar(entry.value)
      if (mode === null) throw widens('sets permissionMode to a value that cannot be read as one mode')
      const rank = CLAUDE_MODE_RANK[mode]
      if (rank === undefined) throw widens(`sets permissionMode "${mode}", which the Claude CLI does not define`)
      if (mode === 'auto') throw widens('sets permissionMode "auto", whose requests a classifier answers instead of a person')
      if (rank > CLAUDE_MODE_RANK[ceiling]!) throw widens(`sets permissionMode "${mode}", wider than the "${ceiling}" the scope runs in`)
    }
    if (TOOL_LIST_KEYS.has(entry.key)) {
      const tools = frontMatterList(entry)
      if (tools === null) throw widens(`sets ${entry.key} to a value that cannot be read as a list`)
      const wide = tools.find(tool => denied.includes(toolName(tool)))
      if (wide) throw widens(`lists the ${wide} tool, which the scope denies`)
    }
    if (entry.key === 'memory') {
      const memory = frontMatterScalar(entry.value)
      if (memory === 'user') throw widens('sets memory "user", written unasked outside the checkout')
      if (writeScope !== 'write-auto' && memory !== null && MEMORY_SCOPES_IN_CHECKOUT.has(memory)) {
        throw widens(`sets memory "${memory}", whose directory is written without asking`)
      }
    }
  }
}

export interface PersonaJudgement {
  name: string
  front: PersonaFrontMatter
}

/**
 * Refuses a Claude persona whose front matter asks for more than the write scope allows. The main thread ignores
 * the file's permissionMode, but the same file spawned as a subagent runs in it, so the scope's mode is its ceiling.
 */
export function assertPersonaWithinScope(personaName: string, text: string, writeScope: BotWriteScope): PersonaJudgement {
  const at = `Persona "${personaName}"`
  const front = parsePersonaFrontMatter(text)
  if (!front) throw new PostureError('persona_unreadable', `${at} has no front matter, so claude --agent would not load it`)
  const token = findBypassToken(front.block)
  if (token) throw new PostureError('bypass', `${at} asks for a blanket permission bypass in its front matter: ${token}`)
  if (front.unreadable) throw new PostureError('persona_unreadable', `${at} ${front.unreadable}`)
  const name = frontMatterName(front)
  if (!name) throw new PostureError('persona_unreadable', `${at} has no name in its front matter, so claude --agent would not find it`)
  if (name !== personaName) throw new PostureError('persona_name_mismatch', `${at} declares the subagent name "${name}", so claude --agent would not find it`)
  assertFrontMatterWithinScope(at, front, writeScope, 'persona_widens')
  return { name, front }
}
