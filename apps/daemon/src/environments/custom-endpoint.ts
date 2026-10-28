import type { LiveVersion, LiveVersionField, LiveVersionSettingError, LiveVersionSettings } from '@candy-mountain/shared'
import { parseJsonPath, readJsonPath, type JsonPathSegment } from './json-path'
import { toHttpLink, toIsoTime } from './live-version'
import { defineLiveVersionSource } from './sources'

export const CUSTOM_ENDPOINT_TIMEOUT_MS = 5_000
const MAX_REDIRECTS = 5
const MAX_BODY_BYTES = 1024 * 1024

export const CUSTOM_ENDPOINT_PATH_FIELDS = {
  version: 'versionPath',
  branch: 'branchPath',
  deployedAt: 'deployedAtPath',
  link: 'linkPath',
} as const satisfies Record<LiveVersionField, string>

const PATH_MAX_LENGTH = 200

class EndpointReadError extends Error {}

export const CUSTOM_ENDPOINT_SOURCE = defineLiveVersionSource({
  id: 'custom-endpoint',
  label: 'Version endpoint',
  description: 'Reads a JSON endpoint the project exposes and maps paths in its response to the version, branch, deploy time and link.',
  fields: [
    { kind: 'string', name: 'url', label: 'Endpoint URL', required: true, placeholder: 'https://example.com/api/debug', pattern: 'https?://\\S+', maxLength: 2048 },
    { kind: 'string', name: 'versionPath', label: 'Version path', description: 'Where the version or commit is in the response, such as commit or build.sha.', placeholder: 'commit', maxLength: PATH_MAX_LENGTH },
    { kind: 'string', name: 'branchPath', label: 'Branch path', placeholder: 'branch', maxLength: PATH_MAX_LENGTH },
    { kind: 'string', name: 'deployedAtPath', label: 'Deployed at path', description: 'An ISO 8601 time or Unix seconds or milliseconds.', placeholder: 'buildStartedAt', maxLength: PATH_MAX_LENGTH },
    { kind: 'string', name: 'linkPath', label: 'Link path', description: 'A URL; a relative one resolves against the endpoint.', placeholder: 'url', maxLength: PATH_MAX_LENGTH },
  ],
  validate: validateCustomEndpoint,
  read: ({ settings, signal, fetch }) => readCustomEndpoint(settings, { signal, fetch }),
})

export function validateCustomEndpoint(settings: LiveVersionSettings): LiveVersionSettingError[] {
  const errors: LiveVersionSettingError[] = []
  try {
    const url = new URL(String(settings.url))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') errors.push({ field: 'url', message: 'Endpoint URL must be http or https.' })
  }
  catch {
    errors.push({ field: 'url', message: 'Endpoint URL must be an absolute URL.' })
  }
  const paths = Object.values(CUSTOM_ENDPOINT_PATH_FIELDS).filter(field => typeof settings[field] === 'string')
  for (const field of paths) {
    const parsed = parseJsonPath(String(settings[field]))
    if (!parsed.ok) errors.push({ field, message: parsed.error })
  }
  if (paths.length === 0) errors.push({ field: '', message: 'Map at least one of the version, branch, deployed at or link paths.' })
  return errors
}

export interface CustomEndpointOptions {
  signal?: AbortSignal
  fetch?: typeof fetch
  timeoutMs?: number
}

export async function readCustomEndpoint(settings: LiveVersionSettings, options: CustomEndpointOptions = {}): Promise<LiveVersion> {
  const mapping = parseMapping(settings)
  const timeoutMs = options.timeoutMs ?? CUSTOM_ENDPOINT_TIMEOUT_MS
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const start = new URL(String(settings.url))

  let body: unknown
  let finalUrl: URL
  try {
    const fetched = await fetchSameHost(start, signal, options.fetch ?? fetch)
    finalUrl = fetched.url
    if (!fetched.response.ok) {
      await fetched.response.body?.cancel()
      throw new EndpointReadError(`${start.host} returned HTTP ${fetched.response.status}.`)
    }
    const text = await readCapped(fetched.response, signal)
    try {
      body = JSON.parse(text)
    }
    catch {
      throw new EndpointReadError(`${start.host} did not return JSON.`)
    }
  }
  catch (error) {
    if (timeout.aborted && !options.signal?.aborted) throw new Error(`No response from ${start.host} within ${timeoutMs / 1000}s.`, { cause: error })
    throw describeFetchError(error, start)
  }

  const version: LiveVersion = {}
  let found = 0
  for (const [field, segments] of mapping) {
    const value = readJsonPath(body, segments)
    if (value === undefined || value === null) continue
    found++
    const converted = convert(field, value, finalUrl)
    if (converted !== undefined) version[field] = converted
  }
  if (mapping.length > 0 && found === 0) throw new Error(`None of the mapped paths were found in the response from ${start.host}.`)
  return version
}

function parseMapping(settings: LiveVersionSettings): [LiveVersionField, JsonPathSegment[]][] {
  const mapping: [LiveVersionField, JsonPathSegment[]][] = []
  for (const [field, setting] of Object.entries(CUSTOM_ENDPOINT_PATH_FIELDS) as [LiveVersionField, string][]) {
    const path = settings[setting]
    if (typeof path !== 'string' || path.trim() === '') continue
    const parsed = parseJsonPath(path)
    if (!parsed.ok) throw new Error(parsed.error)
    mapping.push([field, parsed.segments])
  }
  return mapping
}

function convert(field: LiveVersionField, value: unknown, endpoint: URL): string | undefined {
  switch (field) {
    case 'version':
      return typeof value === 'number' || typeof value === 'string' ? String(value) : undefined
    case 'branch':
      return typeof value === 'string' ? value : undefined
    case 'deployedAt':
      return toIsoTime(value)
    case 'link':
      return toHttpLink(value, endpoint)
  }
}

/** Redirects are followed by hand so an endpoint cannot bounce the daemon onto another host. */
async function fetchSameHost(start: URL, signal: AbortSignal, fetchImpl: typeof fetch): Promise<{ response: Response, url: URL }> {
  let url = start
  for (let hop = 0; ; hop++) {
    const response = await fetchImpl(url, { signal, redirect: 'manual', headers: { 'accept': 'application/json', 'user-agent': 'candy-mountain' } })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status > 399 || !location) return { response, url }
    await response.body?.cancel()
    const next = new URL(location, url)
    if (next.hostname !== start.hostname || (next.protocol !== 'http:' && next.protocol !== 'https:')) {
      throw new EndpointReadError(`${start.host} redirected to ${next.host || next.protocol}; only redirects on the same host are followed.`)
    }
    if (hop >= MAX_REDIRECTS) throw new EndpointReadError(`${start.host} redirected more than ${MAX_REDIRECTS} times.`)
    url = next
  }
}

async function readCapped(response: Response, signal: AbortSignal): Promise<string> {
  const tooLarge = () => new EndpointReadError(`The response is larger than ${MAX_BODY_BYTES / 1024} KiB.`)
  if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
    await response.body?.cancel()
    throw tooLarge()
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    signal.throwIfAborted()
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function describeFetchError(error: unknown, url: URL): Error {
  if (!(error instanceof Error)) return new Error(String(error))
  if (error instanceof EndpointReadError) return error
  if (error instanceof TypeError) {
    const cause = error.cause as { code?: unknown, message?: unknown } | undefined
    const reason = typeof cause?.code === 'string' ? cause.code : typeof cause?.message === 'string' ? cause.message : error.message
    return new Error(`Could not reach ${url.host}: ${reason}.`, { cause: error })
  }
  return error
}
