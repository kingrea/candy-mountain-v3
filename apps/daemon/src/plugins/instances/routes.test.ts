import { FORBIDDEN_ERROR_CODE, PLUGIN_TYPES_PATH, PLUGINS_PATH, type PluginInstance, type PluginInstanceListResponse, type PluginInstanceResponse, type PluginTypeListResponse, type RepositoryBranchList } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginActionError } from '../actions'
import { definePluginType, PluginTypeError } from '../definition'
import { fixturePluginType } from '../fixtures'
import { GOOD_TOKEN, json, stubHosts } from '../repository/fake-hosts'
import { pluginSecretOwner } from '../secrets'
import { repositoryPluginType } from '../types/repository'
import { slackPluginType } from '../types/slack'
import { instanceHarness, multiPluginType, type InstanceHarness } from './test-support'

let h: InstanceHarness
afterEach(() => {
  h?.close()
  vi.unstubAllGlobals()
})

function call(method: string, path: string, body?: unknown, roles?: string[]) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }
  return h.app(roles).request(`${PLUGINS_PATH}${path}`, init)
}

async function created(body: unknown): Promise<PluginInstance> {
  const res = await call('POST', '', body)
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json() as PluginInstanceResponse).instance
}

describe('plugin instance routes', () => {
  it('creates, reads, updates, tests and deletes without ever returning a secret', async () => {
    h = instanceHarness([fixturePluginType('repository'), multiPluginType()])
    const project = await h.createProject('alpha')
    const bodies: string[] = []
    const record = async (res: Response) => {
      bodies.push(await res.clone().text())
      return res
    }

    const instance = await created({ type: 'repository', scope: 'project', project: 'alpha', config: { account: 'jack' }, secrets: { token: 'route-secret-1' } })
    expect(instance).toMatchObject({ projectId: project.id, projectSlug: 'alpha', secrets: { token: 'set' }, health: null })
    await created({ type: 'codex', scope: 'global', secrets: { apiKey: 'route-secret-2' } })

    const list = await record(await call('GET', '?project=alpha'))
    expect((await list.json() as PluginInstanceListResponse).instances.map(i => `${i.type}:${i.scope}`)).toEqual(['repository:project', 'codex:global'])
    expect((await (await record(await call('GET', ''))).json() as PluginInstanceListResponse).instances.map(i => i.type)).toEqual(['codex'])
    await record(await call('GET', `/${instance.id}`))

    const patched = await record(await call('PATCH', `/${instance.id}`, { config: { verbose: true }, secrets: { token: 'route-secret-3' } }))
    expect((await patched.json() as PluginInstanceResponse).instance).toMatchObject({ config: { host: 'alpha', account: 'jack', verbose: true }, secrets: { token: 'set' } })

    const tested = await record(await call('POST', `/${instance.id}/test`))
    expect((await tested.json() as PluginInstanceResponse).instance.health).toEqual({ healthy: true, checkedAt: expect.any(String) })

    for (const body of bodies) expect(body).not.toMatch(/route-secret/)

    expect((await call('DELETE', `/${instance.id}`)).status).toBe(204)
    expect(h.store.isSet(pluginSecretOwner(instance.id), 'token')).toBe(false)
    expect((await call('GET', `/${instance.id}`)).status).toBe(404)
  })

  it('returns error bodies for bad requests', async () => {
    h = instanceHarness([fixturePluginType('repository'), slackPluginType])
    await h.createProject('alpha')
    const good = { type: 'repository', scope: 'project', project: 'alpha', config: { account: 'jack' }, secrets: { token: 't' } }
    const cases: [unknown, number, string][] = [
      ['{', 400, 'invalid_request'],
      [{ ...good, scope: 'team' }, 400, 'invalid_request'],
      [{ ...good, secrets: { token: 3 } }, 400, 'invalid_request'],
      [{ ...good, project: undefined }, 400, 'invalid_request'],
      [{ ...good, type: 'gitlab' }, 422, 'type_not_found'],
      [{ ...good, project: 'ghost' }, 422, 'project_not_found'],
      [{ ...good, scope: 'global', project: undefined }, 422, 'unsupported_scope'],
      [{ type: 'slack', scope: 'project', project: 'alpha', secrets: { botToken: 'x' } }, 422, 'unsupported_scope'],
      [{ ...good, config: { account: '!' } }, 422, 'invalid_config'],
      [{ ...good, secrets: {} }, 422, 'invalid_secrets'],
    ]
    for (const [body, status, code] of cases) {
      const res = await call('POST', '', body)
      expect(res.status, JSON.stringify(body)).toBe(status)
      expect(await res.json()).toEqual({ error: { code, message: expect.any(String) } })
    }
    await created(good)
    const second = await call('POST', '', good)
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ error: { code: 'instance_exists' } })
    expect((await call('GET', '?project=ghost')).status).toBe(422)
    expect((await call('PATCH', '/missing', {})).status).toBe(404)
  })

  it('reports locked secrets as a conflict', async () => {
    h = instanceHarness([fixturePluginType('repository')], { locked: true })
    await h.createProject('alpha')
    const res = await call('POST', '', { type: 'repository', scope: 'project', project: 'alpha', config: { account: 'jack' }, secrets: { token: 't' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: { code: 'secrets_locked' } })
  })

  it('is admin only', async () => {
    h = instanceHarness([multiPluginType()])
    const instance = await created({ type: 'codex', scope: 'global' })
    for (const [method, path] of [['GET', ''], ['POST', ''], ['GET', `/${instance.id}`], ['PATCH', `/${instance.id}`], ['DELETE', `/${instance.id}`], ['POST', `/${instance.id}/test`]]) {
      const res = await call(method!, path!, method === 'GET' || method === 'DELETE' ? undefined : {}, ['developer'])
      expect(res.status, `${method} ${path}`).toBe(403)
      expect(await res.json()).toEqual({ error: { code: FORBIDDEN_ERROR_CODE, message: 'Only the admin may do this' } })
    }
    expect((await call('GET', `/${instance.id}`)).status).toBe(200)
  })

  it('lists plugin types for any signed-in actor', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    const res = await h.app(['developer']).request(PLUGIN_TYPES_PATH)
    const { types } = await res.json() as PluginTypeListResponse
    expect(types.map(t => t.id)).toEqual(['repository'])
    expect(types[0]).not.toHaveProperty('healthCheck')
  })

  it('deletes a project\'s instance secrets with the project', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    await h.createProject('alpha')
    const instance = await created({ type: 'repository', scope: 'project', project: 'alpha', config: { account: 'jack' }, secrets: { token: 't' } })
    expect((await h.app().request('/projects/alpha', { method: 'DELETE' })).status).toBe(204)
    expect(h.store.isSet(pluginSecretOwner(instance.id), 'token')).toBe(false)
    expect((await call('GET', `/${instance.id}`)).status).toBe(404)
  })
})

describe('repository instance actions', () => {
  const repository = (host: string, token: string) => ({ type: 'repository', scope: 'project', project: 'alpha', config: { host, owner: 'jack', repo: 'candy' }, secrets: { token } })

  it.each(['github', 'bitbucket'])('tests the connection and lists branches on %s', async (host) => {
    stubHosts()
    h = instanceHarness([repositoryPluginType])
    await h.createProject('alpha')
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
    h = instanceHarness([repositoryPluginType])
    await h.createProject('alpha')
    const instance = await created(repository(host, 'wrong-token'))

    const tested = (await (await call('POST', `/${instance.id}/test`)).json() as PluginInstanceResponse).instance
    expect(tested.health).toMatchObject({ healthy: false, reason: expect.stringMatching(host === 'github' ? /Bad credentials/ : /Token is invalid/) })

    const res = await call('GET', `/${instance.id}/branches`)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: { code: 'repository_unauthorized', message: expect.not.stringContaining('wrong-token') } })
  })

  it('passes rate limits through with Retry-After', async () => {
    stubHosts(() => json(429, { message: 'slow down' }, { 'retry-after': '30' }))
    h = instanceHarness([repositoryPluginType])
    await h.createProject('alpha')
    const instance = await created(repository('github', GOOD_TOKEN))
    const res = await call('GET', `/${instance.id}/branches`)
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(await res.json()).toMatchObject({ error: { code: 'repository_rate_limited' } })
  })

  it('answers 404 for an action the type does not have', async () => {
    h = instanceHarness([repositoryPluginType])
    await h.createProject('alpha')
    const instance = await created(repository('github', GOOD_TOKEN))
    for (const [method, path] of [['POST', 'branches'], ['GET', 'deploy'], ['GET', 'test'], ['GET', 'constructor']]) {
      const res = await call(method!, `/${instance.id}/${path}`)
      expect(res.status, `${method} ${path}`).toBe(404)
      expect(await res.json()).toMatchObject({ error: { code: 'action_not_found' } })
    }
  })
})

describe('instance action extension point', () => {
  const loginType = () => definePluginType({
    id: 'claude-code',
    name: 'Login fixture',
    description: 'Registers its own instance actions.',
    reach: ['Nothing real.'],
    scopes: ['project'],
    singleInstance: true,
    configFields: [{ kind: 'string', name: 'label', label: 'Label' }],
    secretFields: [{ name: 'session', label: 'Session' }],
    healthCheck: () => ({ healthy: true }),
    actions: {
      'login-start': {
        method: 'POST',
        async run({ instance, request, secrets, paths }) {
          const body = await request.json() as { mode: string }
          return { instance: instance.id, mode: body.mode, hasSession: secrets.get('session') !== undefined, root: paths.root }
        },
      },
      'login-status': {
        method: 'GET',
        run: () => new Response('event: done\n\n', { headers: { 'content-type': 'text/event-stream' } }),
      },
      'login-fail': {
        method: 'GET',
        run() {
          throw new PluginActionError(424, 'login_expired', 'The login code expired.')
        },
      },
    },
  })

  it('mounts a type\'s actions with typed context, raw responses and error bodies', async () => {
    h = instanceHarness([loginType()])
    await h.createProject('alpha')
    const instance = await created({ type: 'claude-code', scope: 'project', project: 'alpha', secrets: { session: 's' } })

    const started = await call('POST', `/${instance.id}/login-start`, { mode: 'device' })
    expect(await started.json()).toEqual({ instance: instance.id, mode: 'device', hasSession: true, root: expect.any(String) })
    const status = await call('GET', `/${instance.id}/login-status`)
    expect(status.headers.get('content-type')).toBe('text/event-stream')
    expect(await status.text()).toBe('event: done\n\n')
    const failed = await call('GET', `/${instance.id}/login-fail`)
    expect(failed.status).toBe(424)
    expect(await failed.json()).toEqual({ error: { code: 'login_expired', message: 'The login code expired.' } })
    expect((await call('POST', `/${instance.id}/login-start`, {}, ['developer'])).status).toBe(403)
  })

  it('rejects badly named or reserved actions when the type is defined', () => {
    const withActions = (actions: unknown) => () => definePluginType({ ...fixturePluginType('netlify'), actions } as never)
    expect(withActions({ test: { method: 'POST', run: () => null } })).toThrow(PluginTypeError)
    expect(withActions({ test: { method: 'POST', run: () => null } })).toThrow('action name \'test\' is reserved.')
    expect(withActions({ Login: { method: 'GET', run: () => null } })).toThrow('lowercase letters, digits and dashes')
    expect(withActions({ login: { method: 'PUT', run: () => null } })).toThrow('needs a method of GET or POST')
    expect(withActions({ login: { method: 'GET' } })).toThrow('needs a run function')
  })
})
