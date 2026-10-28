import type { MonitorOptions } from '@candy-mountain/shared'

export const MONITOR_CHECK_TIMEOUT_MS = 5000
export const MONITOR_MAX_REDIRECTS = 5
export const MONITOR_MAX_BODY_BYTES = 2 * 1024 * 1024

export type MonitorCheckStatus = 'up' | 'degraded' | 'down'

/** One check's own verdict, before any hysteresis across checks. */
export interface MonitorCheckResult {
  /** True only when `status` is `up`. */
  ok: boolean
  status: MonitorCheckStatus
  /** The final response's status, or null when nothing answered. */
  httpStatus: number | null
  /** Why the check is not up; never contains the response body or the target URL. */
  detail: string | null
  latencyMs: number
  checkedAt: string
}

export interface MonitorCheckContext {
  target: string
  options: MonitorOptions
  /** Aborts the check, which then comes back down with detail 'Check cancelled.'. */
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

/** Resolves for every outcome, failures included; it never rejects. */
export type MonitorCheck = (context: MonitorCheckContext) => Promise<MonitorCheckResult>

export interface Verdict {
  status: MonitorCheckStatus
  detail?: string | null
}

export interface ProbeResponse {
  status: number
  text(): Promise<string>
  json(): Promise<unknown>
}

export interface ProbeOptions {
  /** Off when a redirect status is itself the expected answer. */
  followRedirects?: boolean
}

/** A failure a judge raises on purpose; its message is safe to show as the detail. */
export class CheckFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckFailure'
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export const up = (): Verdict => ({ status: 'up' })
export const degraded = (detail: string): Verdict => ({ status: 'degraded', detail })
export const down = (detail: string): Verdict => ({ status: 'down', detail })

/**
 * GETs the target with a timeout covering the body read, follows same-host redirects only,
 * and turns every failure into a down result instead of throwing.
 */
export async function probe(context: MonitorCheckContext, judge: (response: ProbeResponse) => Promise<Verdict> | Verdict, options: ProbeOptions = {}): Promise<MonitorCheckResult> {
  const checkedAt = new Date().toISOString()
  const started = performance.now()
  const timeoutMs = context.timeoutMs ?? MONITOR_CHECK_TIMEOUT_MS
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout
  let httpStatus: number | null = null

  const finish = (verdict: Verdict): MonitorCheckResult => ({
    ok: verdict.status === 'up',
    status: verdict.status,
    httpStatus,
    detail: verdict.status === 'up' ? null : verdict.detail ?? null,
    latencyMs: Math.round(performance.now() - started),
    checkedAt,
  })

  let origin: URL
  try {
    origin = new URL(context.target)
  }
  catch {
    return finish(down('The target is not a valid URL.'))
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return finish(down('The target must be an http or https URL.'))

  try {
    let url = origin
    for (let hops = 0; ; hops++) {
      const response = await (context.fetch ?? globalThis.fetch)(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'Accept': 'application/json, text/plain, */*', 'User-Agent': 'candy-mountain-uptime' },
        signal,
      })
      httpStatus = response.status
      const location = response.headers.get('location')
      if (options.followRedirects !== false && REDIRECT_STATUSES.has(response.status) && location) {
        await response.body?.cancel().catch(() => {})
        const next = new URL(location, url)
        if (!sameHost(origin, next)) return finish(down(`Redirected to another host (${next.host}); only same-host redirects are followed.`))
        if (hops >= MONITOR_MAX_REDIRECTS) return finish(down(`More than ${MONITOR_MAX_REDIRECTS} redirects.`))
        url = next
        continue
      }
      let read = false
      const text = () => {
        read = true
        return readCapped(response, signal)
      }
      const verdict = await judge({
        status: response.status,
        text,
        async json() {
          const body = await text()
          try {
            return JSON.parse(body) as unknown
          }
          catch {
            throw new CheckFailure('The response is not JSON.')
          }
        },
      })
      if (!read) await response.body?.cancel().catch(() => {})
      return finish(verdict)
    }
  }
  catch (error) {
    if (timeout.aborted) return finish(down(`Timed out after ${timeoutMs / 1000} s.`))
    if (context.signal?.aborted) return finish(down('Check cancelled.'))
    if (error instanceof CheckFailure) return finish(down(error.message))
    return finish(down(redact(networkDetail(error, origin), context.target, origin)))
  }
}

/** An http target may upgrade to https on the same host; anything else that leaves the host is refused. */
function sameHost(origin: URL, next: URL): boolean {
  if (next.hostname !== origin.hostname) return false
  return next.protocol === origin.protocol || (origin.protocol === 'http:' && next.protocol === 'https:')
}

/** Watches the signal itself because a stalled body is not always tied to the request's abort. */
async function readCapped(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const onAbort = () => void reader.cancel(signal.reason).catch(() => {})
  signal.addEventListener('abort', onAbort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > MONITOR_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        throw new CheckFailure(`The response is larger than ${MONITOR_MAX_BODY_BYTES / 1024 / 1024} MB.`)
      }
      chunks.push(value)
    }
  }
  finally {
    signal.removeEventListener('abort', onAbort)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function errorCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && typeof current === 'object' && depth < 4; current = (current as { cause?: unknown }).cause, depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

function networkDetail(error: unknown, origin: URL): string {
  const code = errorCode(error)
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `DNS lookup failed for ${origin.hostname}.`
  if (code === 'ECONNREFUSED') return 'Connection refused.'
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'Connection reset.'
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'Connection timed out.'
  if (code && /CERT|TLS|SSL|SELF_SIGNED|VERIFY/.test(code)) return `TLS certificate problem (${code}).`
  if (code) return `Request failed (${code}).`
  const message = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)
  return `Request failed: ${message}`
}

/** Error text can echo the URL back, and a target may carry credentials in its userinfo or query. */
function redact(text: string, target: string, url: URL): string {
  const secrets = [target, url.href, decoded(url.password), url.password, decoded(url.username), url.username, url.search]
    .filter(s => s.length > 1)
    .sort((a, b) => b.length - a.length)
  return secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), text)
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  }
  catch {
    return text
  }
}
