import { pluginTypeInfo, type RepositoryHost } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTestPlatform } from '../../testing/platform'
import { createTempDataDir, type TempDataDir } from '../../testing'
import { checkPluginHealth } from '../health'
import { createPluginTypeRegistry } from '../registry'
import { PLUGIN_TYPES } from '../types'
import { GOOD_TOKEN, json, stubHosts } from './fake-hosts'
import { createRepositoryOperations, listRepositoryBranches, repositoryConfig, repositoryPluginType, RepositoryHostError, type RepositoryConfig } from '.'

const secretsWith = (token?: string) => ({ get: () => token })
const configFor = (host: RepositoryHost, extra: Partial<RepositoryConfig> = {}): RepositoryConfig => ({ host, owner: 'jack', repo: 'candy', ...extra })
const health = (config: RepositoryConfig, token?: string) => checkPluginHealth(repositoryPluginType, { config: { ...config }, secrets: secretsWith(token) })
const ops = (host: RepositoryHost, token: string | undefined = GOOD_TOKEN, extra: Partial<RepositoryConfig> = {}) => createRepositoryOperations(configFor(host, extra), secretsWith(token))
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e)
  expect(error).toBeInstanceOf(RepositoryHostError)
  return error as RepositoryHostError
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('repository plugin type', () => {
  it('is registered as a single-instance, project-only type', () => {
    expect(PLUGIN_TYPES).toContain(repositoryPluginType)
    expect(createPluginTypeRegistry(PLUGIN_TYPES).get('repository')).toBe(repositoryPluginType)
    const info = pluginTypeInfo(repositoryPluginType)
    expect(info.scopes).toEqual(['project'])
    expect(info.singleInstance).toBe(true)
    expect(info.configFields.map(f => f.name)).toEqual(['host', 'owner', 'repo', 'defaultBranch'])
    expect(info.secretFields).toEqual([expect.objectContaining({ name: 'token', required: true })])
  })

  it('validates stored config', () => {
    expect(repositoryConfig({ host: 'bitbucket', owner: ' jack ', repo: 'candy', defaultBranch: '' })).toEqual({ host: 'bitbucket', owner: 'jack', repo: 'candy' })
    expect(() => repositoryConfig({ host: 'gitlab', owner: 'jack', repo: 'candy' })).toThrow(/^Invalid repository config: host: /)
    expect(() => repositoryConfig({ host: 'github', owner: 'jack', repo: 'candy', defaultBranch: 'has space' })).toThrow(/defaultBranch/)
  })

  it('boots the daemon with it registered', () => {
    const temp: TempDataDir = createTempDataDir()
    try {
      const platform = startTestPlatform(temp.root)
      expect(platform.pluginTypes.ids()).toContain('repository')
      platform.close()
    }
    finally {
      temp.cleanup()
    }
  })
})

describe.each<[RepositoryHost, string]>([
  ['github', 'GitHub returned 401 for jack/candy: Bad credentials'],
  ['bitbucket', 'Bitbucket returned 401 for jack/candy: Token is invalid, expired, or not supported for this endpoint.'],
])('%s health', (host, badTokenReason) => {
  it('is healthy with a valid token', async () => {
    const { requests } = stubHosts()
    expect(await health(configFor(host), GOOD_TOKEN)).toEqual({ healthy: true, detail: 'Can read jack/candy and list its branches; default branch \'main\'.' })
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(requests.every(r => r.signal instanceof AbortSignal)).toBe(true)
  })

  it('is unhealthy with the host\'s reason for a wrong token', async () => {
    stubHosts()
    expect(await health(configFor(host), 'wrong-token')).toEqual({ healthy: false, reason: badTokenReason })
  })

  it('is unhealthy when no token is set', async () => {
    const { fetchMock } = stubHosts()
    const name = host === 'github' ? 'GitHub' : 'Bitbucket'
    expect(await health(configFor(host))).toEqual({ healthy: false, reason: `No ${name} token is set for jack/candy.` })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is unhealthy when the repository is missing', async () => {
    stubHosts()
    const result = await health(configFor(host, { repo: 'nope' }), GOOD_TOKEN)
    expect(result).toEqual({ healthy: false, reason: expect.stringContaining('404 for jack/nope') })
  })

  it('is unhealthy when the configured default branch does not exist', async () => {
    stubHosts()
    expect(await health(configFor(host, { defaultBranch: 'develop' }), GOOD_TOKEN)).toEqual({ healthy: false, reason: 'Default branch \'develop\' does not exist in jack/candy.' })
  })

  it('redacts a token the host echoes back', async () => {
    stubHosts(() => json(401, host === 'github' ? { message: `Bad credentials: wrong-token` } : { error: { message: `Bad token wrong-token` } }))
    const result = await health(configFor(host), 'wrong-token')
    expect(result.healthy).toBe(false)
    expect(JSON.stringify(result)).not.toContain('wrong-token')
    expect(JSON.stringify(result)).toContain('[redacted]')
  })
})

describe.each<RepositoryHost>(['github', 'bitbucket'])('%s operations', (host) => {
  it('lists branches most recent first, limited', async () => {
    stubHosts()
    expect(await ops(host).listBranches({ limit: 2 })).toEqual([
      { name: 'feature/login', sha: 'sha-login', committedAt: '2026-10-27T09:00:00Z' },
      { name: 'main', sha: 'sha-main', committedAt: '2026-10-01T10:00:00Z' },
    ])
  })

  it('clamps the branch limit to 1..100 with a default of 30', async () => {
    const { requests } = stubHosts()
    const repository = ops(host)
    await repository.listBranches()
    await repository.listBranches({ limit: 500 })
    await repository.listBranches({ limit: 0 })
    const sent = requests.map(r => (host === 'github' ? (r.body as { variables: { first: number } }).variables.first : Number(r.url.searchParams.get('pagelen'))))
    expect(sent).toEqual([30, 100, 1])
  })

  it('checks whether a file exists on a branch', async () => {
    const { requests } = stubHosts()
    const repository = ops(host)
    expect(await repository.fileExists('.claude/agents/ana.md', 'main')).toBe(true)
    expect(await repository.fileExists('/docs/read me.md', 'main')).toBe(true)
    expect(await repository.fileExists('.agents/ana.md', 'main')).toBe(false)
    expect(await repository.fileExists('.claude/agents', 'main')).toBe(false)
    expect(await repository.fileExists('.claude/agents/ana.md', 'feature/login')).toBe(false)
    expect(requests.some(r => r.url.pathname.endsWith('/docs/read%20me.md'))).toBe(true)
  })

  it('rejects a file check on a missing branch', async () => {
    stubHosts()
    const error = await failure(ops(host).fileExists('README.md', 'gone'))
    expect(error.code).toBe('not_found')
    expect(error.message).toBe('Branch \'gone\' does not exist in jack/candy.')
  })

  it('checks whether a branch exists, including names with slashes', async () => {
    stubHosts()
    const repository = ops(host)
    expect(await repository.branchExists('feature/login')).toBe(true)
    expect(await repository.branchExists('feature')).toBe(false)
  })

  it('reads the host\'s default branch unless one is configured', async () => {
    const { fetchMock } = stubHosts()
    expect(await ops(host).getDefaultBranch()).toBe('main')
    fetchMock.mockClear()
    expect(await ops(host, GOOD_TOKEN, { defaultBranch: 'develop' }).getDefaultBranch()).toBe('develop')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the branch list with the default branch', async () => {
    stubHosts()
    const list = await listRepositoryBranches(ops(host), 1)
    expect(list).toEqual({ defaultBranch: 'main', branches: [expect.objectContaining({ name: 'feature/login' })] })
  })

  it('reports a rate limit with the wait', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 60)
    stubHosts(() => (host === 'github'
      ? json(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })
      : json(429, { error: { message: 'Rate limit for this resource has been exceeded' } }, { 'retry-after': '30' })))
    const error = await failure(ops(host).getDefaultBranch())
    expect(error.code).toBe('rate_limited')
    expect(error.retryAfterSeconds).toBeGreaterThan(0)
    expect(error.message).toMatch(/\(retry in \d+ s\)$/)
  })

  it('wraps a network failure without the token', async () => {
    stubHosts(() => {
      throw new TypeError(`fetch failed for Bearer ${GOOD_TOKEN}`)
    })
    const error = await failure(ops(host).listBranches())
    expect(error.code).toBe('unavailable')
    expect(error.message).not.toContain(GOOD_TOKEN)
  })

  it('passes an abort through untouched', async () => {
    const controller = new AbortController()
    stubHosts(() => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    const repository = createRepositoryOperations(configFor(host), secretsWith(GOOD_TOKEN), { signal: controller.signal })
    await expect(repository.getDefaultBranch()).rejects.toThrow(DOMException)
  })

  it('uses an injected fetch', async () => {
    const fetch = vi.fn(async () => json(200, host === 'github' ? { default_branch: 'trunk' } : { mainbranch: { name: 'trunk' } }))
    expect(await createRepositoryOperations(configFor(host), secretsWith(GOOD_TOKEN), { fetch }).getDefaultBranch()).toBe('trunk')
    expect(fetch).toHaveBeenCalledOnce()
  })
})

describe('github specifics', () => {
  it('sends the REST headers and lists branches through GraphQL', async () => {
    const { requests } = stubHosts()
    await ops('github').listBranches({ limit: 5 })
    const [request] = requests
    expect(request?.method).toBe('POST')
    expect(request?.url.href).toBe('https://api.github.com/graphql')
    expect(request?.headers.get('accept')).toBe('application/vnd.github+json')
    expect(request?.headers.get('x-github-api-version')).toBe('2022-11-28')
    expect(request?.body).toMatchObject({ variables: { owner: 'jack', name: 'candy', first: 5 } })
  })

  it('maps a GraphQL not-found error', async () => {
    stubHosts()
    const error = await failure(ops('github', GOOD_TOKEN, { repo: 'nope' }).listBranches())
    expect(error.code).toBe('not_found')
    expect(error.message).toContain('Could not resolve to a Repository')
  })
})

describe('bitbucket specifics', () => {
  it('sorts by commit date on the host and escapes branch name filters', async () => {
    const { requests } = stubHosts()
    const repository = ops('bitbucket')
    await repository.listBranches({ limit: 3 })
    expect(requests[0]?.url.href).toBe('https://api.bitbucket.org/2.0/repositories/jack/candy/refs/branches?sort=-target.date&pagelen=3')
    await repository.branchExists('we"ird')
    expect(requests[1]?.url.searchParams.get('q')).toBe('name = "we\\"ird"')
  })
})
