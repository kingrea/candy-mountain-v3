const API = 'https://api.heroku.com'

export type HerokuErrorCode = 'no_token' | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable' | 'invalid_response' | 'heroku_error'

export class HerokuApiError extends Error {
  readonly code: HerokuErrorCode
  /** Heroku's own error id, such as 'unauthorized' or 'not_found'. */
  readonly herokuError: string | undefined
  readonly status: number | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(code: HerokuErrorCode, message: string, extra: { herokuError?: string, status?: number, retryAfterSeconds?: number } = {}) {
    super(message)
    this.name = 'HerokuApiError'
    this.code = code
    this.herokuError = extra.herokuError
    this.status = extra.status
    this.retryAfterSeconds = extra.retryAfterSeconds
  }
}

export interface HerokuClientOptions {
  /** Aborts every request the client makes. */
  signal?: AbortSignal
  fetch?: typeof fetch
}

export type HerokuClient = ReturnType<typeof createHerokuClient>

const HINTS: Partial<Record<HerokuErrorCode, string>> = {
  unauthorized: 'the API key is invalid or has expired',
  forbidden: 'the API key cannot access this app',
  not_found: 'check the app name and the API key\'s access',
}

/** Platform API v3 calls over plain fetch; every failure is a HerokuApiError with the key redacted. */
export function createHerokuClient(apiKey: string | undefined, options: HerokuClientOptions = {}) {
  // Fetch errors can echo the request back, Authorization header included.
  const redact = (text: string) => (apiKey ? text.split(apiKey).join('[redacted]') : text)
  const error = (code: HerokuErrorCode, message: string, extra?: { herokuError?: string, status?: number, retryAfterSeconds?: number }) =>
    new HerokuApiError(code, redact(message), extra)

  /** `subject` names what was asked for in error messages, such as "app 'candy'". */
  async function get<T>(path: string, subject: string, headers: Record<string, string> = {}): Promise<T> {
    if (!apiKey) throw error('no_token', 'No Heroku API key is set.')
    let response: Response
    try {
      response = await (options.fetch ?? globalThis.fetch)(`${API}${path}`, {
        method: 'GET',
        headers: { ...headers, 'Accept': 'application/vnd.heroku+json; version=3', 'Authorization': `Bearer ${apiKey}` },
        signal: options.signal,
      })
    }
    catch (cause) {
      if (options.signal?.aborted) throw cause
      throw error('unavailable', `Could not reach Heroku: ${cause instanceof Error ? cause.message : String(cause)}`)
    }

    const text = await response.text().catch(() => '')
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    }
    catch {
      parsed = undefined
    }

    if (!response.ok) {
      const body = parsed !== null && typeof parsed === 'object' ? parsed as { id?: unknown, message?: unknown } : {}
      const herokuError = typeof body.id === 'string' && body.id ? body.id : undefined
      const reason = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : response.statusText
      const seconds = Number(response.headers.get('retry-after') ?? NaN)
      const retryAfterSeconds = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : undefined
      const code = errorCode(response.status)
      const hint = code === 'rate_limited' && retryAfterSeconds !== undefined ? `retry in ${retryAfterSeconds} s` : HINTS[code]
      throw error(code, `Heroku returned ${response.status} for ${subject}${reason ? `: ${reason.replace(/\.$/, '')}` : ''}${hint ? ` (${hint})` : ''}.`, { herokuError, status: response.status, retryAfterSeconds })
    }
    if (parsed === undefined) throw error('invalid_response', `Heroku sent a response that is not JSON for ${subject}.`, { status: response.status })
    return parsed as T
  }

  return { get, error }
}

function errorCode(status: number): HerokuErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  return status >= 500 ? 'unavailable' : 'heroku_error'
}
