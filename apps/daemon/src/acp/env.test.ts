import { describe, expect, it } from 'vitest'
import { AGENT_ENV_ALLOWLIST, AgentEnvError, curateAgentEnv, isDeniedAgentEnv } from './env'

const SECRETS = {
  ANTHROPIC_API_KEY: 'sk-ant',
  ANTHROPIC_AUTH_TOKEN: 'tok',
  ANTHROPIC_BASE_URL: 'https://proxy',
  CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'refresh',
  CLAUDE_CODE_USE_BEDROCK: '1',
  OPENAI_API_KEY: 'sk-oai',
  CODEX_API_KEY: 'sk-codex',
  OPENAI_BASE_URL: 'https://proxy',
  CM_SECRETS_KEY: 'key',
  CM_ADMIN_PASSWORD: 'hunter2',
  CM_DATA_DIR: '/data',
  AWS_SECRET_ACCESS_KEY: 'aws',
  GOOGLE_APPLICATION_CREDENTIALS: '/creds.json',
  GITHUB_TOKEN: 'ghp',
  NODE_OPTIONS: '--require evil',
  LD_PRELOAD: '/evil.so',
}

describe('curateAgentEnv', () => {
  it('passes only the allowlist through from the base environment', () => {
    const base = { ...SECRETS, PATH: '/usr/bin', HOME: '/home/j', LANG: 'en_GB.UTF-8', TERM: 'xterm', EDITOR: 'vim', SSH_AUTH_SOCK: '/tmp/s', EMPTY: '' }
    const env = curateAgentEnv({ base })
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/j', LANG: 'en_GB.UTF-8', TERM: 'xterm' })
    for (const name of Object.keys(SECRETS)) expect(env).not.toHaveProperty(name)
    expect(Object.keys(env).every(name => (AGENT_ENV_ALLOWLIST as readonly string[]).includes(name))).toBe(true)
  })

  it('merges caller extras and refuses denied names', () => {
    expect(curateAgentEnv({ base: { PATH: '/bin' }, extra: { CLAUDE_CODE_OAUTH_TOKEN: 'setup-token', CODEX_HOME: '/h' } })).toEqual({ PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'setup-token', CODEX_HOME: '/h' })
    for (const name of Object.keys(SECRETS)) {
      expect(isDeniedAgentEnv(name), name).toBe(true)
      expect(() => curateAgentEnv({ base: {}, extra: { [name]: 'x' } })).toThrow(AgentEnvError)
    }
    expect(isDeniedAgentEnv('CLAUDE_CODE_OAUTH_TOKEN')).toBe(false)
  })
})
