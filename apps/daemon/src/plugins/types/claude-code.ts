import {
  CLAUDE_CODE_ACTIONS,
  CLAUDE_CODE_TYPE_ACTIONS,
  validatePluginConfig,
  type ClaudeCodeRevokeResponse,
  type ClaudeCodeStartLoginResponse,
  type ClaudeCodeSubmitCodeRequest,
  type ClaudeCodeSubmitCodeResponse,
  type ClaudeExecutableResponse,
  type PluginConfigOf,
  type PluginHealth,
} from '@candy-mountain/shared'
import { PluginActionError } from '../actions'
import { claudeConfigDir, configDirExists, ensureConfigDir, readClaudeAuthStatus, removeConfigDir, type ClaudeAuthStatus } from '../claude-code/cli'
import { probeClaudeExecutable } from '../claude-code/executable'
import { claudeLoginAttempts, LOGIN_FAILURES, type LoginAttemptView } from '../claude-code/login-attempts'
import { definePluginType } from '../definition'

const NOT_LOGGED_IN = 'Not logged in; start the browser login.'
const TOKEN_REJECTED = 'Claude does not accept the stored token; generate a new one with `claude setup-token`.'

function describeStatus(status: ClaudeAuthStatus | { unknown: string }, notLoggedIn: string): PluginHealth {
  if ('unknown' in status) return { healthy: false, reason: status.unknown }
  if (!status.loggedIn) return { healthy: false, reason: notLoggedIn }
  const who = [status.email && `as ${status.email}`, status.subscriptionType && `(${status.subscriptionType})`, status.authMethod && `via ${status.authMethod}`].filter(Boolean).join(' ')
  return { healthy: true, detail: who ? `Logged in ${who}.` : 'Logged in.' }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await request.json()
  }
  catch {
    throw new PluginActionError(400, 'invalid_request', 'Request body must be valid JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PluginActionError(400, 'invalid_request', 'Request body must be an object')
  return body as Record<string, unknown>
}

function notWaiting(attempt: LoginAttemptView): PluginActionError {
  const why = attempt.status === 'expired'
    ? 'The login attempt expired; start again.'
    : attempt.status === 'succeeded'
      ? 'The login attempt already succeeded.'
      : attempt.status === 'failed'
        ? `The login attempt already ended: ${attempt.failure ?? 'it failed.'}`
        : attempt.codeSubmitted ? 'A code was already submitted for this attempt.' : 'The login attempt is not ready for a code yet.'
  return new PluginActionError(409, 'claude_code_attempt_not_waiting', why)
}

export const claudeCodePluginType = definePluginType({
  id: 'claude-code',
  name: 'Claude Code',
  description: 'A Claude account for this project, logged in through the claude CLI in a private config directory.',
  reach: [
    'Chat with Claude Code about this project from the chat panel.',
    'Run this project\'s bots and agent sessions on the configured Claude account.',
  ],
  scopes: ['project'],
  singleInstance: true,
  configFields: [
    {
      kind: 'select',
      name: 'authMode',
      label: 'Sign-in method',
      description: 'Log in through the browser, or paste a long-lived token from `claude setup-token`.',
      options: [{ value: 'login', label: 'Browser login' }, { value: 'token', label: 'Long-lived token' }],
      default: 'login',
    },
    {
      kind: 'string',
      name: 'claudePath',
      label: 'claude executable',
      description: 'Absolute path to the claude executable; leave blank to use the one on PATH.',
      placeholder: '/usr/local/bin/claude',
      pattern: '/.+',
    },
  ],
  secretFields: [
    { name: 'oauthToken', label: 'Long-lived token', description: 'The token printed by `claude setup-token`; used only with the token sign-in method.' },
  ],
  async healthCheck({ config, secrets, signal, instance, paths }): Promise<PluginHealth> {
    if (!instance || !paths) return { healthy: false, reason: 'The Claude Code check needs its instance context.' }
    const configDir = claudeConfigDir(paths, instance.id)
    const command = config.claudePath
    if (config.authMode === 'token') {
      const oauthToken = secrets.get('oauthToken')
      if (!oauthToken) return { healthy: false, reason: 'No long-lived token is set; paste one from `claude setup-token` or switch to browser login.' }
      ensureConfigDir(configDir)
      return describeStatus(await readClaudeAuthStatus({ command, configDir, oauthToken, signal }), TOKEN_REJECTED)
    }
    if (!configDirExists(configDir)) return { healthy: false, reason: NOT_LOGGED_IN }
    return describeStatus(await readClaudeAuthStatus({ command, configDir, signal }), NOT_LOGGED_IN)
  },
  actions: {
    [CLAUDE_CODE_ACTIONS.startLogin]: {
      method: 'POST',
      async run({ instance, config, paths }): Promise<ClaudeCodeStartLoginResponse> {
        if (config.authMode !== 'login') throw new PluginActionError(409, 'claude_code_login_failed', 'The sign-in method is a long-lived token; switch it to browser login first.')
        const attempt = await claudeLoginAttempts.start({ instanceId: instance.id, configDir: claudeConfigDir(paths, instance.id), command: config.claudePath })
        if (attempt.status !== 'waiting' || !attempt.url) throw new PluginActionError(502, 'claude_code_login_failed', attempt.failure ?? LOGIN_FAILURES.noPrompt)
        return { attemptId: attempt.id, url: attempt.url, expiresAt: attempt.expiresAt }
      },
    },
    [CLAUDE_CODE_ACTIONS.submitCode]: {
      method: 'POST',
      async run({ instance, request, refreshHealth }): Promise<ClaudeCodeSubmitCodeResponse> {
        const { attemptId, code } = await readJson(request) as Partial<ClaudeCodeSubmitCodeRequest>
        if (typeof attemptId !== 'string' || typeof code !== 'string') throw new PluginActionError(400, 'invalid_request', 'attemptId and code must be strings')
        const known = claudeLoginAttempts.get(attemptId)
        if (!known || known.instanceId !== instance.id) throw new PluginActionError(404, 'claude_code_attempt_not_found', 'No open login attempt with that id; start the login again.')
        const result = await claudeLoginAttempts.submitCode(attemptId, code)
        switch (result.outcome) {
          case 'not_found':
            throw new PluginActionError(404, 'claude_code_attempt_not_found', 'No open login attempt with that id; start the login again.')
          case 'not_waiting':
            throw notWaiting(result.attempt)
          case 'invalid_code':
            throw new PluginActionError(400, 'claude_code_invalid_code', 'Paste the whole code the browser shows, including the part after #.')
          case 'accepted':
            await refreshHealth()
            return result.attempt.status === 'succeeded'
              ? { attemptId, status: 'logged_in' }
              : { attemptId, status: 'failed', reason: result.attempt.failure ?? LOGIN_FAILURES.codeRejected }
        }
      },
    },
    [CLAUDE_CODE_ACTIONS.revoke]: {
      method: 'POST',
      async run({ instance, paths, secretsWriter, refreshHealth }): Promise<ClaudeCodeRevokeResponse> {
        await claudeLoginAttempts.cancel(instance.id)
        const directoryRemoved = removeConfigDir(claudeConfigDir(paths, instance.id))
        const tokenCleared = instance.secrets.oauthToken === 'set'
        if (tokenCleared) secretsWriter.clear('oauthToken')
        await refreshHealth()
        return { directoryRemoved, tokenCleared }
      },
    },
  },
  typeActions: {
    [CLAUDE_CODE_TYPE_ACTIONS.executable]: {
      method: 'GET',
      /** `?path=` checks one absolute path; without it the daemon searches PATH and the usual install directories. */
      async run({ request, signal }): Promise<ClaudeExecutableResponse> {
        const path = new URL(request.url).searchParams.get('path')?.trim() || undefined
        if (path !== undefined && !/^\/.+/.test(path)) throw new PluginActionError(400, 'invalid_request', 'path must be an absolute path')
        return probeClaudeExecutable({ path, signal })
      },
    },
  },
  async onDelete({ instance, paths }) {
    await claudeLoginAttempts.cancel(instance.id)
    removeConfigDir(claudeConfigDir(paths, instance.id))
  },
})

export type ClaudeCodeConfig = PluginConfigOf<typeof claudeCodePluginType.configFields>

/** Narrows a stored instance config, throwing when it no longer validates. */
export function claudeCodeConfig(config: unknown): ClaudeCodeConfig {
  const result = validatePluginConfig(claudeCodePluginType.configFields, config)
  if (!result.ok) throw new Error(`Invalid Claude Code config: ${result.errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' ')}`)
  return result.config as ClaudeCodeConfig
}
