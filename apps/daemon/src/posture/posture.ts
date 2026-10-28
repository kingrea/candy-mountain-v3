import { BOT_FAMILIES, BOT_PERSONA_NAME_PATTERN, BOT_WRITE_SCOPES, type BotFamily, type BotWriteScope } from '@candy-mountain/shared'
import { isAbsolute } from 'node:path'
import { claudeMcpToolRule, WRAPPED_MCP_TOOLS, type WrappedMcpTool } from '../agent-mcp/tools'
import type { CodexLaunchOptions } from '../acp/families'
import { vetCheckoutAgents } from './checkout-agents'
import { readCheckoutSettings, vetCheckoutSettings, type CheckoutSettingsFile, type NeutralisedItem } from './checkout-settings'
import { claudePostureFlags, claudeSettingsOverride, type ClaudePostureOptions } from './claude'
import { codexPosture } from './codex'
import { PostureError } from './errors'
import { assertPersonaWithinScope } from './front-matter'
import { assertPostureNotWidened } from './verify'

export interface ResolveBotPostureInput {
  family: BotFamily
  writeScope: BotWriteScope
  personaName: string
  /** The persona file as checked out: `.claude/agents/<name>.md` (front matter judged) or `.agents/<name>.md` (sent whole). */
  personaText: string
  /** Platform text appended after the persona. */
  surfaceInstructions?: string
  /** The worktree the session runs in; its `.claude/settings*.json` are read unless `checkoutSettings` is given, and its agent files always. */
  checkoutDir: string
  /** The checkout the worktree was made from, read the same way, since the CLI takes some of its files from there. */
  mainCheckoutDir?: string
  checkoutSettings?: readonly CheckoutSettingsFile[]
  /** The main checkout's `.beads`; Codex write scopes get it as a sandbox writable root. */
  beadsDir?: string
  claude?: ClaudePostureOptions
  /** Daemon-hosted MCP tools the session may call without a prompt; Codex gets its approval with the launch registration. */
  mcpTools?: readonly WrappedMcpTool[]
}

export interface BotPosture {
  family: BotFamily
  writeScope: BotWriteScope
  /** `startSession.flags` for Claude Code; empty for Codex. */
  flags: string[]
  /** `startSession.env` additions; none today, kept so the harness contract is one object. */
  env: Record<string, string>
  /** `startSession.codex` for Codex; absent for Claude Code. */
  codex?: CodexLaunchOptions
  /** The object serialised into `--settings`; null for Codex. */
  settingsOverrides: Record<string, unknown> | null
  neutralised: NeutralisedItem[]
}

export function resolveBotPosture(input: ResolveBotPostureInput): BotPosture {
  if (!(BOT_FAMILIES as readonly string[]).includes(input.family)) throw new PostureError('invalid_input', `Unknown family "${input.family}"`)
  if (!(BOT_WRITE_SCOPES as readonly string[]).includes(input.writeScope)) throw new PostureError('invalid_input', `Unknown write scope "${input.writeScope}"`)
  if (!BOT_PERSONA_NAME_PATTERN.test(input.personaName)) throw new PostureError('invalid_input', `"${input.personaName}" is not a persona name`)
  if (!input.personaText.trim()) throw new PostureError('persona_unreadable', `Persona "${input.personaName}" is empty`)
  if (!isAbsolute(input.checkoutDir)) throw new PostureError('invalid_input', 'checkoutDir must be an absolute path')
  if (input.mainCheckoutDir !== undefined && !isAbsolute(input.mainCheckoutDir)) throw new PostureError('invalid_input', 'mainCheckoutDir must be an absolute path')
  if (input.beadsDir !== undefined && !isAbsolute(input.beadsDir)) throw new PostureError('invalid_input', 'beadsDir must be an absolute path')
  for (const tool of input.mcpTools ?? []) {
    if (!WRAPPED_MCP_TOOLS.some(known => known.server === tool.server && known.tool === tool.tool)) throw new PostureError('invalid_input', `${claudeMcpToolRule(tool)} is not a daemon-hosted MCP tool`)
  }

  const posture = input.family === 'codex' ? resolveCodex(input) : resolveClaude(input)
  assertPostureNotWidened(posture, input.writeScope)
  return posture
}

function resolveCodex(input: ResolveBotPostureInput): BotPosture {
  return {
    family: 'codex',
    writeScope: input.writeScope,
    flags: [],
    env: {},
    codex: codexPosture({ writeScope: input.writeScope, personaText: input.personaText, surfaceInstructions: input.surfaceInstructions, beadsDir: input.beadsDir }),
    settingsOverrides: null,
    neutralised: [],
  }
}

function resolveClaude(input: ResolveBotPostureInput): BotPosture {
  assertPersonaWithinScope(input.personaName, input.personaText, input.writeScope)
  const checkouts = [...new Set([input.checkoutDir, input.mainCheckoutDir ?? input.checkoutDir])]
  const settingsVettings = input.checkoutSettings
    ? [vetCheckoutSettings(input.checkoutSettings, input.checkoutDir, input.writeScope)]
    : checkouts.map(dir => vetCheckoutSettings(readCheckoutSettings(dir), dir, input.writeScope))
  const vettings = [...settingsVettings, ...checkouts.map(dir => vetCheckoutAgents(dir, input.writeScope))]
  const vetting = {
    askRules: [...new Set(vettings.flatMap(v => v.askRules))],
    denyRules: vettings.flatMap(v => v.denyRules),
    neutralised: vettings.flatMap(v => v.neutralised),
  }
  const settingsOverrides = claudeSettingsOverride({ writeScope: input.writeScope, askRules: vetting.askRules, denyRules: vetting.denyRules, options: input.claude })
  return {
    family: 'claude-code',
    writeScope: input.writeScope,
    flags: claudePostureFlags({ writeScope: input.writeScope, personaName: input.personaName, settingsOverride: settingsOverrides, surfaceInstructions: input.surfaceInstructions, mcpToolRules: (input.mcpTools ?? []).map(claudeMcpToolRule) }),
    env: {},
    settingsOverrides,
    neutralised: vetting.neutralised,
  }
}
