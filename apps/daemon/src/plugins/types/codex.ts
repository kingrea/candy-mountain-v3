import { validatePluginConfig, type CodexLoginAttempt, type CodexLoginStatusResponse, type CodexRevokeResponse, type PluginConfigOf } from '@candy-mountain/shared'
import { PluginActionError } from '../actions'
import { CodexLoginAttempts, codexLoginAttempts } from '../codex/attempts'
import { codexCommand, readCodexLoginState } from '../codex/cli'
import { codexHome, removeCodexHome } from '../codex/home'
import { definePluginType } from '../definition'

export function createCodexPluginType(attempts: CodexLoginAttempts) {
  return definePluginType({
    id: 'codex',
    name: 'Codex',
    description: 'Logs the Codex CLI in to a ChatGPT account for this project with a device code, so Codex sessions run on that account.',
    reach: [
      'Run the Codex CLI\'s device login and login status commands in a private Codex home for this project.',
      'Start Codex agent sessions with that login.',
    ],
    scopes: ['project'],
    singleInstance: true,
    configFields: [
      { kind: 'string', name: 'codexPath', label: 'Codex CLI path', description: 'Absolute path to the codex executable. Leave blank to use codex on the daemon\'s PATH.', placeholder: '/usr/local/bin/codex', pattern: '/.+' },
    ],
    secretFields: [],
    async healthCheck({ config, instance, paths, signal }) {
      if (!instance || !paths) return { healthy: false, reason: 'Codex can only be checked for a saved plugin instance.' }
      const state = await readCodexLoginState({ home: codexHome(paths, instance.id), command: codexCommand(config.codexPath), signal })
      if (state.state === 'logged_in') return { healthy: true, detail: state.method ? `Codex is logged in using ${state.method}.` : 'Codex is logged in.' }
      if (state.state === 'logged_out') return { healthy: false, reason: 'Codex is not logged in for this project; start the device login.' }
      return { healthy: false, reason: state.reason }
    },
    actions: {
      'start-login': {
        method: 'POST',
        async run({ config, instance, paths, refreshHealth }): Promise<CodexLoginAttempt> {
          const attempt = await attempts.start({ instanceId: instance.id, home: codexHome(paths, instance.id), command: codexCommand(config.codexPath), onLoggedIn: refreshHealth })
          if (attempt.status !== 'waiting') throw new PluginActionError(502, 'codex_login_failed', attempt.failure ?? 'The Codex device login did not start.')
          return attempt
        },
      },
      'login-status': {
        method: 'GET',
        run: ({ instance }): CodexLoginStatusResponse => ({ attempt: attempts.get(instance.id) }),
      },
      'revoke': {
        method: 'POST',
        async run({ instance, paths, refreshHealth }): Promise<CodexRevokeResponse> {
          await attempts.cancel(instance.id)
          const removed = removeCodexHome(paths, instance.id)
          await refreshHealth()
          return { removed }
        },
      },
    },
    async onDelete({ instance, paths }) {
      await attempts.cancel(instance.id)
      removeCodexHome(paths, instance.id)
    },
  })
}

export const codexPluginType = createCodexPluginType(codexLoginAttempts)

export type CodexConfig = PluginConfigOf<typeof codexPluginType.configFields>

export function codexConfig(config: unknown): CodexConfig {
  const result = validatePluginConfig(codexPluginType.configFields, config)
  if (!result.ok) throw new Error(`Invalid codex config: ${result.errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' ')}`)
  return result.config as CodexConfig
}
