const API = 'https://api.netlify.com/api/v1'

export type NetlifyErrorCode = 'no_token' | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'unavailable' | 'api_error' | 'invalid_response'

export class NetlifyApiError extends Error {
  readonly code: NetlifyErrorCode
  /** Netlify's HTTP status, when it answered. */
  readonly status: number | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(code: NetlifyErrorCode, message: string, extra: { status?: number, retryAfterSeconds?: number } = {}) {
    super(message)
    this.name = 'NetlifyApiError'
    this.code = code
    this.status = extra.status
    this.retryAfterSeconds = extra.retryAfterSeconds
  }
}

export interface NetlifyClientOptions {
  /** Aborts every request the client makes. */
  signal?: AbortSignal
  fetch?: typeof fetch
}

export type NetlifyClient = ReturnType<typeof createNetlifyClient>

const HINTS: Partial<Record<NetlifyErrorCode, string>> = {
  unauthorized: 'the token is invalid or has expired',
  not_found: 'check the site ID and that the token\'s account can see the site',
}

/** REST calls over plain fetch; every failure is a NetlifyApiError with the token redacted. */
export function createNetlifyClient(token: string | undefined, subject: string, options: NetlifyClientOptions = {}) {
  // Fetch errors can echo the request back, Authorization header included.
  const redact = (text: string) => (token ? text.split(token).join('[redacted]') : text)
  const error = (code: NetlifyErrorCode, message: string, extra?: { status?: number, retryAfterSeconds?: number }) =>
    new NetlifyApiError(code, redact(message), extra)

  async function get<T>(path: string): Promise<T> {
    if (!token) throw error('no_token', `No Netlify token is set for ${subject}.`)
    let response: Response
    try {
      response = await (options.fetch ?? globalThis.fetch)(`${API}${path}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}`, 'User-Agent': 'candy-mountain' },
        signal: options.signal,
      })
    }
    catch (cause) {
      if (options.signal?.aborted) throw cause
      throw error('unavailable', `Could not reach Netlify: ${cause instanceof Error ? cause.message : String(cause)}`)
    }

    const text = await response.text().catch(() => '')
    let body: unknown
    try {
      body = JSON.parse(text)
    }
    catch {
      body = undefined
    }

    if (!response.ok) {
      const message = body !== null && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message.trim() : ''
      const reason = message || response.statusText
      const retryAfterSeconds = response.status === 429 ? retryAfter(response) : undefined
      const code = errorCode(response.status)
      const hint = code === 'rate_limited'
        ? (retryAfterSeconds === undefined ? '' : `retry in ${retryAfterSeconds} s`)
        : HINTS[code] ?? ''
      throw error(code, `Netlify returned ${response.status} for ${subject}${reason ? `: ${reason}` : ''}${hint ? ` (${hint})` : ''}`, { status: response.status, retryAfterSeconds })
    }
    if (body === undefined) throw error('invalid_response', `Netlify sent a response that is not JSON for ${subject}.`, { status: response.status })
    return body as T
  }

  return { get, error }
}

function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after') ?? NaN)
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds))
  const reset = Number(response.headers.get('x-ratelimit-reset') ?? NaN)
  return Number.isFinite(reset) ? Math.max(0, Math.ceil(reset - Date.now() / 1000)) : undefined
}

function errorCode(status: number): NetlifyErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  return status >= 500 ? 'unavailable' : 'api_error'
}
