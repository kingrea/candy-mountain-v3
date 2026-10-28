import { vi } from 'vitest'

export const GOOD_TOKEN = 'good-token-123'

export interface RecordedRequest {
  method: string
  url: URL
  headers: Headers
  body: unknown
  signal: AbortSignal | null | undefined
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

interface Branch { name: string, sha: string, date: string }

const BRANCHES: Branch[] = [
  { name: 'main', sha: 'sha-main', date: '2026-10-01T10:00:00Z' },
  { name: 'feature/login', sha: 'sha-login', date: '2026-10-27T09:00:00Z' },
  { name: 'old', sha: 'sha-old', date: '2025-01-01T00:00:00Z' },
]
const byRecent = () => [...BRANCHES].sort((a, b) => b.date.localeCompare(a.date))
const FILES = new Set(['.claude/agents/ana.md', 'docs/read me.md'])
const DIRS = new Set(['.claude/agents'])

export type FakeHandler = (request: RecordedRequest) => Response | undefined

/** Stubs global fetch with an in-memory GitHub and Bitbucket serving jack/candy; `override` answers first. */
export function stubHosts(override?: FakeHandler) {
  const requests: RecordedRequest[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: RecordedRequest = {
      method: init.method ?? 'GET',
      url: new URL(String(input)),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init.signal,
    }
    requests.push(request)
    return override?.(request) ?? (request.url.host === 'api.github.com' ? github(request) : bitbucket(request))
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

function github({ method, url, headers, body }: RecordedRequest): Response {
  if (headers.get('authorization') !== `Bearer ${GOOD_TOKEN}`) return json(401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' })
  const path = decodeURIComponent(url.pathname)
  if (method === 'POST' && path === '/graphql') {
    const { variables } = body as { variables: { owner: string, name: string, first: number } }
    if (`${variables.owner}/${variables.name}` !== 'jack/candy') {
      return json(200, { data: { repository: null }, errors: [{ type: 'NOT_FOUND', message: `Could not resolve to a Repository with the name '${variables.owner}/${variables.name}'.` }] })
    }
    const nodes = byRecent().slice(0, variables.first).map(b => ({ name: b.name, target: { oid: b.sha, committedDate: b.date } }))
    return json(200, { data: { repository: { refs: { nodes } } } })
  }
  if (path === '/repos/jack/candy') return json(200, { full_name: 'jack/candy', default_branch: 'main' })
  const ref = path.match(/^\/repos\/jack\/candy\/git\/ref\/heads\/(.+)$/)
  if (ref) {
    const branch = BRANCHES.find(b => b.name === ref[1])
    return branch ? json(200, { ref: `refs/heads/${branch.name}`, object: { sha: branch.sha, type: 'commit' } }) : json(404, { message: 'Not Found' })
  }
  const content = path.match(/^\/repos\/jack\/candy\/contents\/(.+)$/)
  if (content && url.searchParams.get('ref') === 'sha-main') {
    if (FILES.has(content[1]!)) return json(200, { type: 'file', path: content[1] })
    if (DIRS.has(content[1]!)) return json(200, [{ type: 'file', name: 'ana.md' }])
  }
  return json(404, { message: 'Not Found' })
}

function bitbucket({ url, headers }: RecordedRequest): Response {
  if (headers.get('authorization') !== `Bearer ${GOOD_TOKEN}`) {
    return json(401, { type: 'error', error: { message: 'Token is invalid, expired, or not supported for this endpoint.' } })
  }
  const path = decodeURIComponent(url.pathname)
  if (path === '/2.0/repositories/jack/candy') return json(200, { full_name: 'jack/candy', mainbranch: { name: 'main', type: 'branch' } })
  if (path === '/2.0/repositories/jack/candy/refs/branches') {
    const q = url.searchParams.get('q')
    const name = q?.match(/^name = "(.*)"$/)?.[1]?.replace(/\\(.)/g, '$1')
    const sorted = url.searchParams.get('sort') === '-target.date' ? byRecent() : BRANCHES
    const values = sorted.filter(b => name === undefined || b.name === name).slice(0, Number(url.searchParams.get('pagelen') ?? 10))
    return json(200, { pagelen: values.length, values: values.map(b => ({ name: b.name, target: { hash: b.sha, date: b.date } })) })
  }
  const src = path.match(/^\/2\.0\/repositories\/jack\/candy\/src\/sha-main\/(.+)$/)
  if (src && url.searchParams.get('format') === 'meta') {
    if (FILES.has(src[1]!)) return json(200, { type: 'commit_file', path: src[1] })
    if (DIRS.has(src[1]!)) return json(200, { type: 'commit_directory', path: src[1] })
  }
  return json(404, { type: 'error', error: { message: 'Resource not found' } })
}
