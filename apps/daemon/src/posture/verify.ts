import type { BotFamily, BotWriteScope } from '@candy-mountain/shared'
import { basename, isAbsolute, normalize } from 'node:path'
import { WRAPPED_MCP_TOOL_RULES } from '../agent-mcp/tools'
import { CODEX_AGENT_MODES, CODEX_LAUNCHER_ENV, type CodexLaunchOptions } from '../acp/families'
import { CLAUDE_BASELINE_ALLOWED_TOOLS, CLAUDE_DENIED_TOOLS, CLAUDE_EDIT_TOOLS, CLAUDE_PERMISSION_MODES, CLAUDE_PUSH_ASK_RULES } from './claude'
import { CODEX_MODES } from './codex'
import { PostureError } from './errors'
import { findBypassToken } from './tokens'

/** Flags that would replace or route around the posture, whatever their value. */
export const CLAUDE_REFUSED_FLAGS: Readonly<Record<string, string>> = {
  '--dangerously-skip-permissions': 'it bypasses every permission check',
  '--allow-dangerously-skip-permissions': 'it makes the bypass mode available',
  '--permission-prompt-tool': 'the shim owns the decision relay',
  '--setting-sources': 'it would drop the checkout settings the override is written against',
  '--bare': 'it skips the checkout CLAUDE.md and settings the override is written against',
  '--system-prompt': 'it replaces the persona prompt',
  '--system-prompt-file': 'it replaces the persona prompt',
  '--append-system-prompt-file': 'instructions must be passed as text so they can be checked',
  '--agents': 'inline personas are not repository personas',
  '--tools': 'it replaces the tool set the scope was mapped against',
  '--add-dir': 'the scope is the worktree only',
  '--mcp-config': 'only the launch registers MCP servers, and only the daemon-hosted ones',
  '--permission-prompts': 'the shim owns the decision relay',
}

/** Flags whose value is free text; everything else is scanned for bypass tokens. */
const TEXT_FLAGS = new Set(['--append-system-prompt'])

const VARIADIC_FLAGS = new Set(['--allowedTools', '--allowed-tools', '--disallowedTools', '--disallowed-tools'])

export interface VerifiablePosture {
  family: BotFamily
  flags: readonly string[]
  env: Readonly<Record<string, string>>
  codex?: CodexLaunchOptions
  settingsOverrides: Record<string, unknown> | null
}

interface ParsedFlags {
  values: Map<string, string[][]>
  texts: string[]
}

function parseFlags(flags: readonly string[]): ParsedFlags {
  const values = new Map<string, string[][]>()
  const texts: string[] = []
  for (let index = 0; index < flags.length; index++) {
    const token = flags[index]!
    if (!token.startsWith('--')) throw new PostureError('widened', `Unexpected positional argument "${token}" in the claude flags`)
    const eq = token.indexOf('=')
    const name = eq === -1 ? token : token.slice(0, eq)
    const occurrence: string[] = eq === -1 ? [] : [token.slice(eq + 1)]
    if (eq === -1) {
      while (index + 1 < flags.length && !flags[index + 1]!.startsWith('--') && (VARIADIC_FLAGS.has(name) || occurrence.length === 0)) {
        occurrence.push(flags[++index]!)
      }
    }
    if (TEXT_FLAGS.has(name)) texts.push(...occurrence)
    const list = values.get(name) ?? []
    list.push(occurrence)
    values.set(name, list)
  }
  return { values, texts }
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function refuse(message: string): never {
  throw new PostureError('widened', message)
}

function splitRules(occurrences: string[][] | undefined): string[] {
  return (occurrences ?? []).flat().flatMap(value => value.split(',')).map(rule => rule.trim()).filter(Boolean)
}

function verifyClaude(posture: VerifiablePosture, writeScope: BotWriteScope): void {
  const { values, texts } = parseFlags(posture.flags)
  const scanned = posture.flags.filter(flag => !texts.includes(flag))
  const token = findBypassToken([...scanned, ...Object.values(posture.env)].join('\n'))
  if (token) refuse(`The claude flags carry a blanket permission bypass: ${token}`)
  for (const [flag, reason] of Object.entries(CLAUDE_REFUSED_FLAGS)) {
    if (values.has(flag)) refuse(`${flag} is refused: ${reason}`)
  }

  const expectedMode = CLAUDE_PERMISSION_MODES[writeScope]
  const modes = values.get('--permission-mode')?.map(v => v[0]) ?? []
  if (modes.length !== 1 || modes[0] !== expectedMode) refuse(`--permission-mode must be exactly "${expectedMode}" for the ${writeScope} scope (got ${modes.join(', ') || 'none'})`)

  const settingsFlags = values.get('--settings') ?? []
  if (settingsFlags.length !== 1) refuse('Exactly one --settings override is expected')
  let settings: unknown
  try {
    settings = JSON.parse(settingsFlags[0]![0] ?? '')
  }
  catch {
    refuse('--settings must be inline JSON; a settings file path cannot be verified')
  }
  if (!isObject(settings)) refuse('--settings must be a JSON object')
  if (JSON.stringify(settings) !== JSON.stringify(posture.settingsOverrides)) refuse('--settings does not match settingsOverrides')
  const settingsToken = findBypassToken(JSON.stringify(settings).replace(/"disableBypassPermissionsMode":"disable"/g, ''))
  if (settingsToken) refuse(`--settings carries a blanket permission bypass: ${settingsToken}`)
  if (settings.disableAllHooks !== true) refuse('--settings must set disableAllHooks: true')
  if (settings.enableAllProjectMcpServers !== false) refuse('--settings must set enableAllProjectMcpServers: false')
  if (!values.has('--strict-mcp-config')) refuse('--strict-mcp-config is required')
  if (settings.hooks !== undefined) refuse('--settings may not define hooks')
  if (settings.apiKeyHelper !== undefined || settings.env !== undefined) refuse('--settings may not change authentication or the environment')
  const permissions = settings.permissions
  if (!isObject(permissions)) refuse('--settings must set permissions')
  if (permissions.defaultMode !== expectedMode) refuse(`--settings permissions.defaultMode must be "${expectedMode}"`)
  if (permissions.disableBypassPermissionsMode !== 'disable') refuse('--settings must set permissions.disableBypassPermissionsMode: "disable"')
  if (permissions.disableAutoMode !== 'disable') refuse('--settings must set permissions.disableAutoMode: "disable"')
  if (permissions.allow !== undefined) refuse('--settings may not add allow rules')
  if (permissions.additionalDirectories !== undefined) refuse('--settings may not add directories')
  if (writeScope === 'read-only' && settings.useAutoModeDuringPlan !== false) refuse('read-only must set useAutoModeDuringPlan: false')
  const sandbox = settings.sandbox
  if (!isObject(sandbox)) refuse('--settings must state the sandbox')
  if (writeScope === 'write-auto') {
    if (sandbox.enabled !== true || sandbox.failIfUnavailable !== true) refuse('write-auto must run with the sandbox on and required')
    if (sandbox.allowUnsandboxedCommands !== false) refuse('write-auto must forbid unsandboxed retries, which also locks the repository sandbox entries')
    const ask = Array.isArray(permissions.ask) ? permissions.ask : []
    for (const rule of CLAUDE_PUSH_ASK_RULES) {
      if (!ask.includes(rule)) refuse(`write-auto must keep the ${rule} ask rule`)
    }
  }
  else if (sandbox.enabled !== false) refuse(`${writeScope} must keep the sandbox off; it auto-approves commands`)

  const allowed = splitRules(values.get('--allowedTools')).concat(splitRules(values.get('--allowed-tools')))
  for (const rule of CLAUDE_BASELINE_ALLOWED_TOOLS) {
    if (!allowed.includes(rule)) refuse(`${rule} must always be allowed`)
  }
  for (const rule of allowed) {
    const tool = rule.replace(/\(.*$/, '')
    if ((CLAUDE_EDIT_TOOLS as readonly string[]).includes(tool)) refuse(`An editing tool may not be allowed outright: ${rule}`)
    if (rule === 'Bash' || /^Bash\(\s*\*/.test(rule)) refuse(`A blanket shell allow is refused: ${rule}`)
    if (rule === '*' || /^[^(]*\*/.test(rule)) refuse(`A tool-name wildcard allow is refused: ${rule}`)
    if (/^mcp__/i.test(tool) && !WRAPPED_MCP_TOOL_RULES.includes(rule)) refuse(`Only daemon-hosted MCP tools may be allowed: ${rule}`)
  }
  const denied = splitRules(values.get('--disallowedTools')).concat(splitRules(values.get('--disallowed-tools')))
  for (const tool of CLAUDE_DENIED_TOOLS[writeScope]) {
    if (!denied.includes(tool)) refuse(`${tool} must be denied for the ${writeScope} scope`)
  }
  const agents = values.get('--agent') ?? []
  if (agents.length !== 1 || !agents[0]![0]) refuse('Exactly one --agent persona is expected')
  for (const text of texts) {
    if (text.startsWith('-')) refuse('Instruction text may not start with "-", which the CLI would read as a flag')
  }
}

const CODEX_POSTURE_KEYS = new Set(['mode', 'developerInstructions', 'writableRoots'])

function verifyCodex(posture: VerifiablePosture, writeScope: BotWriteScope): void {
  if (posture.flags.length) refuse('The Codex adapter takes no flags')
  for (const name of Object.keys(posture.env)) {
    if ((CODEX_LAUNCHER_ENV as readonly string[]).includes(name)) refuse(`${name} is set by the Codex launcher and may not be overridden`)
  }
  const mode = posture.codex?.mode
  if (mode === undefined || !(CODEX_AGENT_MODES as readonly string[]).includes(mode)) refuse(`Codex mode "${mode ?? ''}" is not one of ${CODEX_AGENT_MODES.join(', ')}`)
  if (mode !== CODEX_MODES[writeScope]) refuse(`Codex mode must be "${CODEX_MODES[writeScope]}" for the ${writeScope} scope`)
  const token = findBypassToken(Object.values(posture.env).join('\n'))
  if (token) refuse(`The Codex environment carries a blanket permission bypass: ${token}`)
  const extra = Object.keys(posture.codex ?? {}).filter(key => !CODEX_POSTURE_KEYS.has(key))
  if (extra.length) refuse(`Unknown Codex options ${extra.join(', ')}`)
  const roots = posture.codex?.writableRoots
  if (roots === undefined) return
  if (mode !== 'workspace-write') refuse(`Codex writable roots are refused for the ${writeScope} scope`)
  if (!Array.isArray(roots) || roots.length === 0) refuse('Codex writable roots must be a non-empty list')
  // The main checkout's .beads is the only root a bot is given, so any other directory is a widening.
  for (const root of roots as unknown[]) {
    if (typeof root !== 'string' || !isAbsolute(root) || normalize(root) !== root || basename(root) !== '.beads') refuse(`Codex writable root ${JSON.stringify(root)} is not an absolute .beads directory`)
  }
}

/** Refuses a posture that is anything other than the scope's own mapping; also run inside `resolveBotPosture`. */
export function assertPostureNotWidened(posture: VerifiablePosture, writeScope: BotWriteScope): void {
  if (posture.family === 'codex') verifyCodex(posture, writeScope)
  else verifyClaude(posture, writeScope)
}
