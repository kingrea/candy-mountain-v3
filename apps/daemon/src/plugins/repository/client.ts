import { REPOSITORY_HOST_NAMES, type RepositoryErrorCode, type RepositoryHost } from '@candy-mountain/shared'

export class RepositoryHostError extends Error {
  readonly host: RepositoryHost
  readonly code: RepositoryErrorCode
  /** The host's HTTP status, when it answered. */
  readonly status: number | undefined
  readonly retryAfterSeconds: number | undefined

  constructor(host: RepositoryHost, code: RepositoryErrorCode, message: string, extra: { status?: number, retryAfterSeconds?: number } = {}) {
    super(message)
    this.name = 'RepositoryHostError'
    this.host = host
    this.code = code
    this.status = extra.status
    this.retryAfterSeconds = extra.retryAfterSeconds
  }
}

export interface HostClientOptions {
  host: RepositoryHost
  baseUrl: string
  token: string | undefined
  /** owner/repo, used in error messages. */
  subject: string
  headers: Record<string, string>
  errorMessage(body: unknown): unknown
  fetch?: typeof fetch
  signal?: AbortSignal
}

export type HostClient = ReturnType<typeof createHostClient>

export const encodePath = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/')

export function createHostClient(options: HostClientOptions) {
  const { host, token, subject } = options
  const name = REPOSITORY_HOST_NAMES[host]
  // Hosts and fetch errors can echo the request back, Authorization header included.
  const redact = (text: string) => (token ? text.split(token).join('[redacted]') : text)
  const error = (code: RepositoryErrorCode, message: string, extra?: { status?: number, retryAfterSeconds?: number }) => new RepositoryHostError(host, code, redact(message), extra)

  async function send(path: string, init: { method?: string, body?: unknown } = {}): Promise<Response> {
    if (!token) throw error('no_token', `No ${name} token is set for ${subject}.`)
    const doFetch = options.fetch ?? globalThis.fetch
    try {
      return await doFetch(`${options.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: { ...options.headers, Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: options.signal,
      })
    }
    catch (cause) {
      if (options.signal?.aborted) throw cause
      throw error('unavailable', `Could not reach ${name}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async function parse<T>(response: Response): Promise<T> {
    const text = await response.text()
    try {
      return JSON.parse(text) as T
    }
    catch {
      throw error('invalid_response', `${name} sent a response that is not JSON for ${subject}.`)
    }
  }

  async function fail(response: Response): Promise<never> {
    const text = await response.text().catch(() => '')
    let detail: unknown
    try {
      detail = options.errorMessage(JSON.parse(text))
    }
    catch {
      detail = undefined
    }
    const reason = typeof detail === 'string' && detail.trim() ? detail.trim() : response.statusText
    const retryAfterSeconds = retryAfter(response)
    const code = errorCode(response, retryAfterSeconds)
    const hint = code === 'not_found'
      ? ' (check the owner, the repository name and the token\'s access)'
      : code === 'rate_limited' && retryAfterSeconds !== undefined ? ` (retry in ${retryAfterSeconds} s)` : ''
    throw error(code, `${name} returned ${response.status} for ${subject}${reason ? `: ${reason}` : ''}${hint}`, { status: response.status, retryAfterSeconds })
  }

  async function read<T>(path: string, init?: { method?: string, body?: unknown }): Promise<T> {
    const response = await send(path, init)
    if (!response.ok) return fail(response)
    return parse<T>(response)
  }

  return { host, name, subject, send, parse, fail, read, error }
}

function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after') ?? NaN)
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds))
  if (response.headers.get('x-ratelimit-remaining') !== '0') return undefined
  const reset = Number(response.headers.get('x-ratelimit-reset') ?? NaN)
  return Number.isFinite(reset) ? Math.max(0, Math.ceil(reset - Date.now() / 1000)) : undefined
}

function errorCode(response: Response, retryAfterSeconds: number | undefined): RepositoryErrorCode {
  const { status } = response
  if (status === 401) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  // GitHub signals an exhausted rate limit with 403 rather than 429.
  if (status === 403) return retryAfterSeconds !== undefined ? 'rate_limited' : 'forbidden'
  if (status === 404) return 'not_found'
  return status >= 500 ? 'unavailable' : 'host_error'
}
