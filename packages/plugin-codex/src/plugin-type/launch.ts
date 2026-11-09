import type { PluginInstanceHealth } from '@crab-shack/platform-sdk'
import { type DataPaths, type PluginInstanceDeps, resolvePluginInstance } from '@crab-shack/platform-daemon'
import { codexConfig } from './definition'
import { codexHome } from './home'

export interface CodexLaunchContext {
  instanceId: string
  /** The project's private Codex home, passed to the CLI and the adapter as `CODEX_HOME`. */
  home: string
  /** The configured CLI for `CODEX_PATH`; undefined means `codex` on PATH. */
  command: string | undefined
  /** The stored result of the last health check; read it instead of probing, which can hold the CLI's token refresh lock. */
  health: PluginInstanceHealth | null
}

/** Null when the project has no Codex plugin instance. */
export function codexLaunchContext(deps: PluginInstanceDeps & { paths: Pick<DataPaths, 'agentHomes'> }, projectId: string): CodexLaunchContext | null {
  const instance = resolvePluginInstance(deps, projectId, 'codex')
  if (!instance) return null
  return { instanceId: instance.id, home: codexHome(deps.paths, instance.id), command: codexConfig(instance.config).codexPath, health: instance.health }
}
