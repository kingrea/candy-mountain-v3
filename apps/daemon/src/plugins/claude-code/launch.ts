import type { PluginInstance } from '@candy-mountain/shared'
import type { DataPaths } from '../../data-dir'
import { resolvePluginInstance, type PluginInstanceDeps, type SecretsReader } from '../instances/instances'
import { createPluginSecrets } from '../secrets'
import { claudeCodeConfig, claudeCodePluginType, type ClaudeCodeConfig } from '../types/claude-code'
import { CLAUDE_OAUTH_TOKEN_ENV, claudeConfigDir, ensureConfigDir } from './cli'

export interface ClaudeCodeLaunchContext {
  instance: PluginInstance
  config: ClaudeCodeConfig
  /** The session's CLAUDE_CONFIG_DIR, created 0700 on demand. */
  configDir: string
  /** The claude executable to drive; undefined means the one on PATH. */
  command: string | undefined
  /** Extra child environment: CLAUDE_CODE_OAUTH_TOKEN in token mode, nothing otherwise. */
  env: Record<string, string>
}

export class ClaudeCodeLaunchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeCodeLaunchError'
  }
}

/**
 * What a session launcher needs for a project's Claude Code instance, without running `claude auth status`:
 * probing right before a session can hold the CLI's OAuth refresh lock, so a missing login must surface as
 * the session's own auth-required error instead. Null when the project has no instance.
 */
export function claudeCodeLaunchContext(deps: PluginInstanceDeps & { secretsReader: SecretsReader, paths: Pick<DataPaths, 'agentHomes'> }, projectId: string): ClaudeCodeLaunchContext | null {
  const instance = resolvePluginInstance(deps, projectId, 'claude-code')
  if (!instance) return null
  const config = claudeCodeConfig(instance.config)
  const configDir = ensureConfigDir(claudeConfigDir(deps.paths, instance.id))
  const env: Record<string, string> = {}
  if (config.authMode === 'token') {
    const token = createPluginSecrets(deps.secretsReader, instance.id, claudeCodePluginType).get('oauthToken')
    if (!token) throw new ClaudeCodeLaunchError('The Claude Code plugin uses a long-lived token but none is stored.')
    env[CLAUDE_OAUTH_TOKEN_ENV] = token
  }
  return { instance, config, configDir, command: config.claudePath, env }
}
