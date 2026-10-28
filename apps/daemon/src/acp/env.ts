/** The only inherited variables an agent process receives. */
export const AGENT_ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR'] as const

/** Never reach an agent, even when a caller asks for them by name. */
export const AGENT_ENV_DENIED_NAMES = [
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CODEX_API_KEY',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
] as const

export const AGENT_ENV_DENIED_PREFIXES = ['ANTHROPIC_', 'OPENAI_', 'CM_', 'AWS_', 'AZURE_', 'GOOGLE_CLOUD_', 'VERTEX_', 'MASTRA_'] as const

export class AgentEnvError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} may not be passed to an agent process`)
    this.name = 'AgentEnvError'
  }
}

export function isDeniedAgentEnv(name: string): boolean {
  return (AGENT_ENV_DENIED_NAMES as readonly string[]).includes(name) || AGENT_ENV_DENIED_PREFIXES.some(prefix => name.startsWith(prefix))
}

export interface CurateAgentEnvOptions {
  base?: NodeJS.ProcessEnv
  /** Caller-supplied additions, checked against the denylist; CLAUDE_CODE_OAUTH_TOKEN is the expected use. */
  extra?: Record<string, string>
}

export function curateAgentEnv({ base = process.env, extra = {} }: CurateAgentEnvOptions = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of AGENT_ENV_ALLOWLIST) {
    const value = base[name]
    if (value) env[name] = value
  }
  for (const [name, value] of Object.entries(extra)) {
    if (isDeniedAgentEnv(name)) throw new AgentEnvError(name)
    env[name] = value
  }
  return env
}
