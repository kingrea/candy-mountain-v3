import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import type { AgentFamily } from './events'

export interface FamilyLaunch {
  command: string
  args: string[]
  /** Set by the harness for the family itself, on top of the curated environment. */
  env: Record<string, string>
  /** Sent as `additionalDirectories` on session/new and session/load. */
  additionalDirectories?: string[]
}

/** Adapter modes a Codex session may start in; both send every escalation to the user. */
export const CODEX_AGENT_MODES = ['read-only', 'workspace-write'] as const
export type CodexAgentMode = typeof CODEX_AGENT_MODES[number]
export const DEFAULT_CODEX_AGENT_MODE: CodexAgentMode = 'read-only'

/** What codex-acp 2.3.0 resends with every turn for each mode, so nothing in its config can override it. */
export const CODEX_MODE_POSTURE = {
  'read-only': { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' },
  'workspace-write': { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' },
} as const satisfies Record<CodexAgentMode, { approvalPolicy: string, approvalsReviewer: string, sandbox: string }>

const REFUSED_CODEX_MODES: Record<string, string> = {
  'agent': 'its auto-review lets Codex approve its own escalations without asking the user',
  'agent-full-access': 'it drops both the approval prompts and the sandbox',
}

export interface CodexLaunchOptions {
  mode?: CodexAgentMode
  /** Persona text, sent as the developer instructions of every new or loaded session. */
  developerInstructions?: string
  /** A model id from the adapter's `model` config option. */
  model?: string
  /** A value of the adapter's `reasoning_effort` config option. */
  reasoningEffort?: string
  /** Absolute directories the workspace-write sandbox may write outside the cwd; refused in read-only mode. */
  writableRoots?: string[]
}

const CODEX_MODEL_ID = /^[A-Za-z0-9][\w.:/-]{0,127}$/
const CODEX_REASONING_EFFORT = /^[a-z][a-z_-]{0,31}$/

/** Adapter variables only the launcher sets; the others would switch on a model gateway, auto-login, log files or unfiltered MCP config. */
export const CODEX_LAUNCHER_ENV = [
  'CODEX_HOME',
  'CODEX_PATH',
  'NO_BROWSER',
  'INITIAL_AGENT_MODE',
  'CODEX_CONFIG',
  'DEFAULT_AUTH_REQUEST',
  'APP_SERVER_LOGS',
  'MODEL_PROVIDER',
  'DISABLE_MCP_CONFIG_FILTERING',
] as const

/** A daemon-hosted MCP endpoint registered for one launch; never persisted, since its port and token change with each daemon boot. */
export interface LaunchMcpServer {
  name: string
  /** Streamable HTTP on the loopback interface. */
  url: string
  bearerToken: string
  /** Pre-approved; for Codex also the only tools enabled. */
  tools: string[]
}

const MCP_SERVER_NAME = /^[a-z][a-z0-9_]{0,47}$/
const MCP_TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/
const MCP_BEARER_TOKEN = /^[\w-]{32,128}$/

export function assertLaunchMcpServers(servers: readonly LaunchMcpServer[]): void {
  const names = new Set<string>()
  for (const server of servers) {
    if (!MCP_SERVER_NAME.test(server.name) || names.has(server.name)) throw new AcpLaunchError(`MCP server name ${JSON.stringify(server.name)} is not a unique server name`)
    names.add(server.name)
    let url: URL
    try {
      url = new URL(server.url)
    }
    catch {
      throw new AcpLaunchError(`MCP server ${server.name} has no valid URL`)
    }
    // Only the daemon's own loopback endpoint, which holds the credentials and the scope, may be handed to an agent.
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw new AcpLaunchError(`MCP server ${server.name} must be a loopback http://127.0.0.1:<port> endpoint`)
    if (!MCP_BEARER_TOKEN.test(server.bearerToken)) throw new AcpLaunchError(`MCP server ${server.name} needs a bearer token`)
    if (!server.tools.length || server.tools.some(tool => !MCP_TOOL_NAME.test(tool))) throw new AcpLaunchError(`MCP server ${server.name} must name its tools`)
  }
}

function claudeMcpConfig(servers: readonly LaunchMcpServer[]): string {
  return JSON.stringify({ mcpServers: Object.fromEntries(servers.map(server => [server.name, { type: 'http', url: server.url, headers: { Authorization: `Bearer ${server.bearerToken}` } }])) })
}

/** Approved here rather than per call, because codex-acp's own MCP registration cannot carry an approval mode. */
function codexMcpConfig(servers: readonly LaunchMcpServer[]): Record<string, unknown> {
  return Object.fromEntries(servers.map(server => [server.name, {
    url: server.url,
    http_headers: { Authorization: `Bearer ${server.bearerToken}` },
    enabled_tools: [...server.tools],
    default_tools_approval_mode: 'approve',
  }]))
}

export interface FamilyLaunchOptions {
  configHome: string
  /** Posture flags forwarded verbatim to claude; refused for Codex. */
  flags?: string[]
  /** The CLI executable to drive instead of the one on PATH (claude) or the bundled one (codex). */
  command?: string
  turnTimeoutMs?: number
  /** The caller's extra child variables, vetted here only for names the family launcher owns. */
  env?: Record<string, string>
  codex?: CodexLaunchOptions
  mcpServers?: readonly LaunchMcpServer[]
}

export interface FamilyEntry {
  command: string
  args: string[]
}

/** Test seam: run the shim or adapter from somewhere other than the installed build. */
export interface FamilyBins {
  claudeShim?: FamilyEntry
  codexAdapter?: FamilyEntry
}

export class AcpLaunchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AcpLaunchError'
  }
}

/** A launch that would let the agent act without a human answering its permission prompts. */
export class AcpBypassRefusedError extends AcpLaunchError {
  readonly code = 'bypass_refused'
  readonly setting: string

  constructor(setting: string, reason: string) {
    super(`${setting} is refused: ${reason}`)
    this.name = 'AcpBypassRefusedError'
    this.setting = setting
  }
}

export const CLAUDE_BYPASS_FLAGS = ['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'] as const
/** `auto` lets a model classifier approve instead of the human, which is a bypass by another name. */
export const CLAUDE_BYPASS_MODES = ['bypassPermissions', 'auto'] as const
export const CLAUDE_LAUNCH_PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'manual', 'dontAsk'] as const
const BYPASS_TOKENS = ['bypassPermissions', 'dangerously-skip-permissions']
const PROMPT_TEXT_FLAGS = new Set(['--append-system-prompt', '--system-prompt'])
const ALLOWED_TOOLS_FLAGS = new Set(['--allowedTools', '--allowed-tools'])
const JSON_FLAGS = new Set(['--settings', '--agents'])

/** Splits an allow list on commas and spaces outside parentheses, as the CLI does. */
function allowRules(value: string): string[] {
  const rules: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth++
    if (char === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current) rules.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) rules.push(current)
  return rules
}

/** An allow rule that approves every tool, or every shell command, asks nothing in practice. */
function isBlanketAllow(rule: string): boolean {
  const match = /^([^()]*)(?:\((.*)\))?$/s.exec(rule.trim())
  if (!match) return true
  const tool = match[1]!.trim()
  const content = match[2]
  if (tool === '' || (tool.includes('*') && !/^mcp__[^*]+__\*$/.test(tool))) return true
  if (tool !== 'Bash' && tool !== 'PowerShell') return false
  return content === undefined || /^[\s*:]*$/.test(content)
}

function refuseModeValue(setting: string, mode: unknown): void {
  if ((CLAUDE_BYPASS_MODES as readonly unknown[]).includes(mode)) throw new AcpBypassRefusedError(setting, `the ${String(mode)} mode approves actions without asking`)
  if (!(CLAUDE_LAUNCH_PERMISSION_MODES as readonly unknown[]).includes(mode)) throw new AcpBypassRefusedError(setting, `unknown permission mode ${JSON.stringify(mode)}; use ${CLAUDE_LAUNCH_PERMISSION_MODES.join(', ')}`)
}

function vetSettingsValue(flag: string, value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => vetSettingsValue(flag, item, `${path}[${index}]`))
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, nested] of Object.entries(value)) {
    const at = `${path}.${key}`
    if (key === 'defaultMode' || key === 'permissionMode') refuseModeValue(`${flag} ${at}`, nested)
    if (key === 'allow' && path.endsWith('permissions') && Array.isArray(nested)) {
      for (const rule of nested) {
        if (typeof rule !== 'string' || isBlanketAllow(rule)) throw new AcpBypassRefusedError(`${flag} ${at}`, `the allow rule ${JSON.stringify(rule)} approves everything without asking`)
      }
    }
    vetSettingsValue(flag, nested, at)
  }
}

function readJsonFlag(flag: string, value: string): unknown {
  let text = value
  if (!value.trimStart().startsWith('{')) {
    // A relative path would resolve against wherever the CLI happens to start, so only an absolute file can be checked.
    if (!isAbsolute(value)) throw new AcpBypassRefusedError(flag, 'a settings file must be an absolute path so it can be checked')
    try {
      text = readFileSync(value, 'utf8')
    }
    catch {
      throw new AcpBypassRefusedError(flag, `${value} could not be read, so it cannot be checked`)
    }
  }
  try {
    return JSON.parse(text)
  }
  catch {
    throw new AcpBypassRefusedError(flag, 'the value is not valid JSON, so it cannot be checked')
  }
}

/** The never-bypass rule for Claude Code: refuses, by name, any flag or setting that would skip the human's answer. */
export function assertClaudeNeverBypass(flags: readonly string[]): void {
  for (let index = 0; index < flags.length; index++) {
    const arg = flags[index]!
    const [name, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    const values: string[] = []
    if (inline !== undefined) values.push(inline)
    else if (PROMPT_TEXT_FLAGS.has(name)) index++
    else if (name.startsWith('--')) {
      // Commander options such as --allowedTools are variadic, so every following non-flag argument belongs to this one.
      while (index + 1 < flags.length && !flags[index + 1]!.startsWith('-')) values.push(flags[++index]!)
    }
    if (PROMPT_TEXT_FLAGS.has(name)) continue
    if ((CLAUDE_BYPASS_FLAGS as readonly string[]).includes(name)) throw new AcpBypassRefusedError(name, 'it skips every permission prompt')
    if (name === '--permission-prompt-tool') throw new AcpBypassRefusedError(name, 'permission prompts must reach the daemon over stdio')
    const token = [arg, ...values].flatMap(text => BYPASS_TOKENS.filter(candidate => text.includes(candidate)))[0]
    if (token) throw new AcpBypassRefusedError(name, `it carries ${token}`)
    if (name === '--permission-mode') {
      if (values.length !== 1) throw new AcpBypassRefusedError(name, 'it takes exactly one mode')
      refuseModeValue(name, values[0])
    }
    if (ALLOWED_TOOLS_FLAGS.has(name)) {
      for (const rule of values.flatMap(allowRules)) {
        if (isBlanketAllow(rule)) throw new AcpBypassRefusedError(name, `the rule ${JSON.stringify(rule)} approves everything without asking`)
      }
    }
    if (JSON_FLAGS.has(name)) {
      if (values.length !== 1) throw new AcpBypassRefusedError(name, 'it takes exactly one value')
      vetSettingsValue(name, readJsonFlag(name, values[0]!), '')
    }
  }
}

const require = createRequire(import.meta.url)

function packageDir(name: string): string {
  try {
    return dirname(require.resolve(`${name}/package.json`))
  }
  catch {
    throw new AcpLaunchError(`${name} is not installed next to the daemon`)
  }
}

export function claudeShimEntry(): FamilyEntry {
  const bin = join(packageDir('@candy-mountain/claude-acp'), 'dist', 'cli.mjs')
  if (!existsSync(bin)) throw new AcpLaunchError(`${bin} is missing; run pnpm build first`)
  return { command: process.execPath, args: [bin] }
}

export function codexAdapterEntry(): FamilyEntry {
  const bin = join(packageDir('@agentclientprotocol/codex-acp'), 'dist', 'index.js')
  if (!existsSync(bin)) throw new AcpLaunchError(`${bin} is missing`)
  return { command: process.execPath, args: [bin] }
}

export function resolveFamilyLaunch(family: AgentFamily, options: FamilyLaunchOptions, bins: FamilyBins = {}): FamilyLaunch {
  if (!isAbsolute(options.configHome)) throw new AcpLaunchError('configHome must be an absolute path')
  const mcpServers = options.mcpServers ?? []
  assertLaunchMcpServers(mcpServers)
  const flags = options.flags ?? []
  if (family === 'claude-code') {
    if (options.codex) throw new AcpLaunchError('codex options apply only to the codex family')
    assertClaudeNeverBypass(flags)
    const shim = bins.claudeShim ?? claudeShimEntry()
    const own = ['--config-dir', options.configHome]
    if (options.command) own.push('--claude', options.command)
    if (options.turnTimeoutMs) own.push('--turn-timeout-ms', String(options.turnTimeoutMs))
    // --mcp-config is variadic, so it goes last; strict keeps every other MCP configuration out.
    const mcp = mcpServers.length ? [...(flags.includes('--strict-mcp-config') ? [] : ['--strict-mcp-config']), '--mcp-config', claudeMcpConfig(mcpServers)] : []
    return { command: shim.command, args: [...shim.args, ...own, '--', ...flags, ...mcp], env: {} }
  }
  return resolveCodexLaunch(options, bins.codexAdapter ?? codexAdapterEntry())
}

function codexMode(requested: string | undefined): CodexAgentMode {
  if (requested === undefined) return DEFAULT_CODEX_AGENT_MODE
  if ((CODEX_AGENT_MODES as readonly string[]).includes(requested)) return requested as CodexAgentMode
  const refused = Object.hasOwn(REFUSED_CODEX_MODES, requested) ? REFUSED_CODEX_MODES[requested] : undefined
  // The adapter quietly falls back to its auto-review mode for an id it does not know.
  throw new AcpLaunchError(refused ? `Codex mode "${requested}" is refused: ${refused}` : `Unknown Codex mode "${requested}"; use ${CODEX_AGENT_MODES.join(' or ')}`)
}

/** The adapter merges CODEX_CONFIG into every thread/start and thread/resume, so these hold for resumed sessions too. */
function codexConfig({ developerInstructions, model, reasoningEffort }: CodexLaunchOptions): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  const instructions = developerInstructions?.trim()
  if (instructions) config.developer_instructions = instructions
  if (model !== undefined) {
    if (!CODEX_MODEL_ID.test(model)) throw new AcpLaunchError(`Codex model ${JSON.stringify(model)} is not a model id`)
    config.model = model
  }
  if (reasoningEffort !== undefined) {
    if (!CODEX_REASONING_EFFORT.test(reasoningEffort)) throw new AcpLaunchError(`Codex reasoning effort ${JSON.stringify(reasoningEffort)} is not an effort level`)
    config.model_reasoning_effort = reasoningEffort
  }
  return config
}

function codexWritableRoots(mode: CodexAgentMode, roots: readonly string[] | undefined): string[] {
  if (!roots?.length) return []
  if (mode !== 'workspace-write') throw new AcpLaunchError(`Codex writable roots need the workspace-write mode, not ${mode}`)
  for (const root of roots) {
    if (typeof root !== 'string' || !isAbsolute(root)) throw new AcpLaunchError(`Codex writable root ${JSON.stringify(root)} must be an absolute path`)
  }
  return [...new Set(roots)]
}

/** Throws AcpLaunchError for a Codex posture the launcher would refuse, without spawning anything. */
export function assertCodexLaunchOptions(options: CodexLaunchOptions): void {
  codexWritableRoots(codexMode(options.mode), options.writableRoots)
  codexConfig(options)
}

function resolveCodexLaunch(options: FamilyLaunchOptions, adapter: FamilyEntry): FamilyLaunch {
  // Besides --version the adapter only reads argv for its `login` (opens a browser) and `cli` (bypasses ACP) subcommands.
  if (options.flags?.length) throw new AcpLaunchError('The Codex adapter takes no flags; set its posture through the codex options')
  for (const name of Object.keys(options.env ?? {})) {
    if ((CODEX_LAUNCHER_ENV as readonly string[]).includes(name)) throw new AcpLaunchError(`${name} is set by the Codex launcher; use the codex options instead of env`)
  }
  const mode = codexMode(options.codex?.mode)
  const config = codexConfig(options.codex ?? {})
  const writableRoots = codexWritableRoots(mode, options.codex?.writableRoots)
  if (writableRoots.length) config.sandbox_workspace_write = { writable_roots: writableRoots }
  if (options.mcpServers?.length) config.mcp_servers = codexMcpConfig(options.mcpServers)
  // Empty values read as unset to the adapter; stating them keeps auto-login and log files off even if the allowlist grows.
  const env: Record<string, string> = {
    CODEX_HOME: options.configHome,
    NO_BROWSER: '1',
    DEFAULT_AUTH_REQUEST: '',
    APP_SERVER_LOGS: '',
    INITIAL_AGENT_MODE: mode,
    CODEX_CONFIG: Object.keys(config).length ? JSON.stringify(config) : '',
  }
  if (options.command) env.CODEX_PATH = options.command
  // The adapter resends the mode's sandbox policy, with no writable roots, on every turn; only its session directories are added back to it.
  return { command: adapter.command, args: [...adapter.args], env, ...(writableRoots.length ? { additionalDirectories: writableRoots } : {}) }
}
