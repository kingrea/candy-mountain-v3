import { PLUGINS_PATH, type PluginInstance, type PluginInstanceResponse } from '@candy-mountain/platform-sdk'
import type { RepositoryBranchList } from '../wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { instanceHarness, openTestDatabase, type InstanceHarness } from '@candy-mountain/platform-daemon'
import { repositoryDefinition } from '../definition'
import { createWorkspaceWithRepository } from '../test-support'
import { repositoryPluginType } from './definition'
import { GOOD_TOKEN, json } from './fake-hosts'
import { stubHosts } from './stub-hosts'

let h: InstanceHarness

// Workspaces carry a repository, as in the product.
const harness = () => instanceHarness([repositoryPluginType], { openDatabase: () => openTestDatabase({ definitions: [repositoryDefinition()] }), createWorkspace: createWorkspaceWithRepository })
afterEach(() => {
  h?.close()
  vi.unstubAllGlobals()
})

function call(method: string, path: string, body?: unknown, roles?: string[]) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return h.app(roles).request(`${PLUGINS_PATH}${path}`, init)
}

async function created(body: unknown): Promise<PluginInstance> {
  const res = await call('POST', '', body)
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json() as PluginInstanceResponse).instance
}

describe('repository instance actions', () => {
  const repository = (host: string, token: string) => ({ type: 'repository', scope: 'workspace', workspace: 'alpha', config: { host, owner: 'jack', repo: 'candy' }, secrets: { token } })

  it.each(['github', 'bitbucket'])('tests the connection and lists branches on %s', async (host) => {
    stubHosts()
    h = harness()
    await h.createWorkspace('alpha')
    const instance = await created(repository(host, GOOD_TOKEN))

    const tested = (await (await call('POST', `/${instance.id}/test`)).json() as PluginInstanceResponse).instance
    expect(tested.health).toMatchObject({ healthy: true, detail: expect.stringContaining('jack/candy') })

    const res = await call('GET', `/${instance.id}/branches?limit=2`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual<RepositoryBranchList>({
      defaultBranch: 'main',
      branches: [
        { name: 'feature/login', sha: 'sha-login', committedAt: '2026-10-27T09:00:00Z' },
        { name: 'main', sha: 'sha-main', committedAt: '2026-10-01T10:00:00Z' },
      ],
    })
  })

  it.each(['github', 'bitbucket'])('records the host\'s reason for a wrong token on %s and maps branch errors', async (host) => {
    stubHosts()
    h = harness()
    await h.createWorkspace('alpha')
    const instance = await created(repository(host, 'wrong-token'))

    const tested = (await (await call('POST', `/${instance.id}/test`)).json() as PluginInstanceResponse).instance
    expect(tested.health).toMatchObject({ healthy: false, reason: expect.stringMatching(host === 'github' ? /Bad credentials/ : /Token is invalid/) })

    const res = await call('GET', `/${instance.id}/branches`)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: { code: 'repository_unauthorized', message: expect.not.stringContaining('wrong-token') } })
  })

  it('passes rate limits through with Retry-After', async () => {
    stubHosts(() => json(429, { message: 'slow down' }, { 'retry-after': '30' }))
    h = harness()
    await h.createWorkspace('alpha')
    const instance = await created(repository('github', GOOD_TOKEN))
    const res = await call('GET', `/${instance.id}/branches`)
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(await res.json()).toMatchObject({ error: { code: 'repository_rate_limited' } })
  })

  it('answers 404 for an action the type does not have', async () => {
    h = harness()
    await h.createWorkspace('alpha')
    const instance = await created(repository('github', GOOD_TOKEN))
    for (const [method, path] of [['POST', 'branches'], ['GET', 'deploy'], ['GET', 'test'], ['GET', 'constructor']]) {
      const res = await call(method!, `/${instance.id}/${path}`)
      expect(res.status, `${method} ${path}`).toBe(404)
      expect(await res.json()).toMatchObject({ error: { code: 'action_not_found' } })
    }
  })
})
