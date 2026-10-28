const API = 'https://slack.com/api'

export type SlackErrorCode = 'no_token' | 'invalid_request' | 'unavailable' | 'rate_limited' | 'invalid_response' | 'slack_error'

export class SlackApiError extends Error {
  /** The Web API method, such as 'chat.postMessage'. */
  readonly method: string
  readonly code: SlackErrorCode
  /** Slack's own error string, such as 'invalid_auth' or 'not_in_channel'. */
  readonly slackError: string | undefined
  readonly status: number | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(method: string, code: SlackErrorCode, message: string, extra: { slackError?: string, status?: number, retryAfterSeconds?: number } = {}) {
    super(message)
    this.name = 'SlackApiError'
    this.method = method
    this.code = code
    this.slackError = extra.slackError
    this.status = extra.status
    this.retryAfterSeconds = extra.retryAfterSeconds
  }
}

export interface SlackClientOptions {
  /** Aborts every request the client makes. */
  signal?: AbortSignal
  fetch?: typeof fetch
}

export type SlackClient = ReturnType<typeof createSlackClient>

const BAD_TOKEN = 'the bot token is invalid or has been revoked'
const HINTS: Record<string, string> = {
  invalid_auth: BAD_TOKEN,
  not_authed: BAD_TOKEN,
  token_revoked: BAD_TOKEN,
  token_expired: BAD_TOKEN,
  account_inactive: BAD_TOKEN,
  channel_not_found: 'the channel does not exist or the bot cannot see it',
  not_in_channel: 'invite the bot to the channel first',
  is_archived: 'the channel is archived',
  user_not_found: 'no such member in the workspace',
  user_disabled: 'the member has been deactivated',
}

interface SlackResponse { ok?: unknown, error?: unknown, needed?: unknown }

/** Web API calls over plain fetch; every failure is a SlackApiError with the token redacted. */
export function createSlackClient(token: string | undefined, options: SlackClientOptions = {}) {
  // Fetch errors can echo the request back, Authorization header included.
  const redact = (text: string) => (token ? text.split(token).join('[redacted]') : text)
  const error = (method: string, code: SlackErrorCode, message: string, extra?: { slackError?: string, status?: number, retryAfterSeconds?: number }) =>
    new SlackApiError(method, code, redact(message), extra)

  async function call<T extends object>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    if (!token) throw error(method, 'no_token', 'No Slack bot token is set.')
    let response: Response
    try {
      response = await (options.fetch ?? globalThis.fetch)(`${API}/${method}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
        signal: options.signal,
      })
    }
    catch (cause) {
      if (options.signal?.aborted) throw cause
      throw error(method, 'unavailable', `Could not reach Slack: ${cause instanceof Error ? cause.message : String(cause)}`)
    }

    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after') ?? NaN)
      const retryAfterSeconds = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : undefined
      throw error(method, 'rate_limited', `Slack rate-limited ${method}${retryAfterSeconds === undefined ? '' : `; retry in ${retryAfterSeconds} s`}.`, { status: 429, retryAfterSeconds })
    }

    const text = await response.text().catch(() => '')
    let parsed: SlackResponse | undefined
    try {
      const value: unknown = JSON.parse(text)
      parsed = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as SlackResponse : undefined
    }
    catch {
      parsed = undefined
    }

    if (!response.ok && typeof parsed?.error !== 'string') {
      throw error(method, response.status >= 500 ? 'unavailable' : 'slack_error', `Slack returned ${response.status} for ${method}.`, { status: response.status })
    }
    if (!parsed) throw error(method, 'invalid_response', `Slack sent a response that is not a JSON object for ${method}.`, { status: response.status })
    if (parsed.ok === true) return parsed as T

    const slackError = typeof parsed.error === 'string' && parsed.error ? parsed.error : 'unknown_error'
    const hint = slackError === 'missing_scope' && typeof parsed.needed === 'string'
      ? `the bot token needs the ${parsed.needed} scope`
      : HINTS[slackError]
    throw error(method, slackError === 'ratelimited' ? 'rate_limited' : 'slack_error', `Slack ${method} failed: ${slackError}${hint ? ` (${hint})` : ''}.`, { slackError, status: response.status })
  }

  return { call, error }
}
