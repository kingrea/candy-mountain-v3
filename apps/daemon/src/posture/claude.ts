import type { BotWriteScope } from '@candy-mountain/shared'

export const CLAUDE_PERMISSION_MODES = {
  'read-only': 'plan',
  'write-confirm': 'default',
  'write-auto': 'acceptEdits',
} as const satisfies Record<BotWriteScope, string>
export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[BotWriteScope]

/** Always allowed: the issue tracker every checkout keeps its work in. */
export const CLAUDE_BASELINE_ALLOWED_TOOLS = ['Bash(bd *)'] as const

/** ExitPlanMode's approval can carry a mode switch the relay offers as "always allow". */
export const CLAUDE_PLAN_EXIT_TOOLS = ['ExitPlanMode'] as const
/** A subagent runs in its own front-matter permissionMode under a plan or default parent, so spawning one can widen the scope. */
export const CLAUDE_SUBAGENT_TOOLS = ['Agent', 'Workflow'] as const

export const CLAUDE_DENIED_TOOLS: Record<BotWriteScope, readonly string[]> = {
  'read-only': [...CLAUDE_PLAN_EXIT_TOOLS, ...CLAUDE_SUBAGENT_TOOLS],
  'write-confirm': [...CLAUDE_SUBAGENT_TOOLS],
  'write-auto': [],
}

export const CLAUDE_EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const

/** An ask rule outranks every allow rule and the sandbox's auto-approval, so a push always reaches a person. */
export const CLAUDE_PUSH_ASK_RULES = ['Bash(git push *)'] as const

/** Sandboxed commands may reach only these without a prompt; the git hosts for fetch and push, the registry for installs. */
export const CLAUDE_SANDBOX_DEFAULT_DOMAINS = ['github.com', 'api.github.com', 'bitbucket.org', 'api.bitbucket.org', 'registry.npmjs.org'] as const
/** Package-manager stores outside the worktree that an install must write. */
export const CLAUDE_SANDBOX_DEFAULT_WRITE_PATHS = ['~/.local/share/pnpm/store', '~/.cache/pnpm', '~/.npm'] as const

export interface ClaudePostureOptions {
  sandboxAllowedDomains?: readonly string[]
  sandboxAllowWrite?: readonly string[]
}

export interface ClaudeOverrideInput {
  writeScope: BotWriteScope
  /** Checkout allow rules to outrank; ask beats allow whatever file either comes from. */
  askRules: readonly string[]
  denyRules: readonly string[]
  options?: ClaudePostureOptions
}

/** `bd` runs outside the sandbox (it writes the main checkout's issue database), where the baseline allow rule approves it. */
function sandboxSettings(options: ClaudePostureOptions = {}): Record<string, unknown> {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    // false also makes the CLI ignore the repository's own excludedCommands, allowedDomains and allowWrite.
    allowUnsandboxedCommands: false,
    enableWeakerNestedSandbox: false,
    excludedCommands: [...CLAUDE_BASELINE_ALLOWED_TOOLS.map(rule => rule.slice('Bash('.length, -1))],
    filesystem: { allowWrite: [...(options.sandboxAllowWrite ?? CLAUDE_SANDBOX_DEFAULT_WRITE_PATHS)] },
    network: {
      allowedDomains: [...(options.sandboxAllowedDomains ?? CLAUDE_SANDBOX_DEFAULT_DOMAINS)],
      allowLocalBinding: false,
      allowAllUnixSockets: false,
    },
  }
}

/** The inline `--settings` JSON: above the checkout's files for every scalar key, and an ask list that outranks their allow rules. */
export function claudeSettingsOverride({ writeScope, askRules, denyRules, options }: ClaudeOverrideInput): Record<string, unknown> {
  const ask = [...(writeScope === 'write-auto' ? CLAUDE_PUSH_ASK_RULES : []), ...askRules]
  const permissions: Record<string, unknown> = {
    defaultMode: CLAUDE_PERMISSION_MODES[writeScope],
    disableBypassPermissionsMode: 'disable',
    disableAutoMode: 'disable',
    ...(ask.length ? { ask } : {}),
    ...(denyRules.length ? { deny: [...denyRules] } : {}),
  }
  return {
    disableAllHooks: true,
    enableAllProjectMcpServers: false,
    ...(writeScope === 'read-only' ? { useAutoModeDuringPlan: false } : {}),
    permissions,
    sandbox: writeScope === 'write-auto' ? sandboxSettings(options) : { enabled: false },
  }
}

export interface ClaudeFlagsInput {
  writeScope: BotWriteScope
  personaName: string
  settingsOverride: Record<string, unknown>
  surfaceInstructions?: string
  /** Allow rules for daemon-hosted MCP tools, which the launch registers. */
  mcpToolRules?: readonly string[]
}

/** Flags after the shim's `--`, in a fixed order; variadic lists are one comma-joined value so the next flag ends them. */
export function claudePostureFlags({ writeScope, personaName, settingsOverride, surfaceInstructions, mcpToolRules = [] }: ClaudeFlagsInput): string[] {
  const flags = [
    '--permission-mode', CLAUDE_PERMISSION_MODES[writeScope],
    '--settings', JSON.stringify(settingsOverride),
    '--strict-mcp-config',
    '--agent', personaName,
  ]
  if (surfaceInstructions) flags.push('--append-system-prompt', surfaceInstructions)
  flags.push('--allowedTools', [...CLAUDE_BASELINE_ALLOWED_TOOLS, ...mcpToolRules].join(','))
  const denied = CLAUDE_DENIED_TOOLS[writeScope]
  if (denied.length) flags.push('--disallowedTools', denied.join(','))
  return flags
}
