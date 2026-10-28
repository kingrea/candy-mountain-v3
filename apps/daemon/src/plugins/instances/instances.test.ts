import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginHealth } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { pluginInstances } from '../../db/schema'
import { fixturePluginType } from '../fixtures'
import { pluginSecretOwner } from '../secrets'
import { slackPluginType } from '../types/slack'
import { PluginInstanceError } from './errors'
import {
  createPluginInstance,
  deletePluginInstance,
  deleteProjectPluginInstances,
  findPluginInstance,
  getPluginInstance,
  listPluginInstances,
  refreshPluginInstanceHealth,
  resetPluginInstanceHealth,
  resolvePluginInstance,
  testPluginInstance,
  updatePluginInstance,
} from './instances'
import { instanceHarness, multiPluginType, type InstanceHarness } from './test-support'

let h: InstanceHarness
afterEach(() => h?.close())

const config = { account: 'jack' }
const code = (fn: () => unknown) => {
  try {
    fn()
  }
  catch (error) {
    if (error instanceof PluginInstanceError) return error.code
    throw error
  }
  throw new Error('expected a PluginInstanceError')
}

describe('creating plugin instances', () => {
  it('stores secrets encrypted and only ever reports them as set', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    const project = await h.createProject('alpha')
    const created = createPluginInstance(h.deps, { type: 'repository', scope: 'project', projectId: project.id, config, secrets: { token: 'tok-SUPER-secret' } })

    expect(created).toMatchObject({ type: 'repository', scope: 'project', projectId: project.id, projectSlug: 'alpha', config: { host: 'alpha', account: 'jack' }, secrets: { token: 'set' }, health: null })
    const file = join(h.secretsDir, pluginSecretOwner(created.id), 'token.json')
    expect(readFileSync(file, 'utf8')).not.toContain('tok-SUPER-secret')
    expect(h.store.get(pluginSecretOwner(created.id), 'token')).toBe('tok-SUPER-secret')
    for (const view of [created, getPluginInstance(h.deps, created.id), ...listPluginInstances(h.deps, { projectId: project.id })]) {
      expect(JSON.stringify(view)).not.toContain('tok-SUPER-secret')
      expect(view.secrets).toEqual({ token: 'set' })
    }
  })

  it('rejects a scope the type does not support', async () => {
    h = instanceHarness([fixturePluginType('repository'), slackPluginType])
    const project = await h.createProject('alpha')
    expect(code(() => createPluginInstance(h.deps, { type: 'repository', scope: 'global', projectId: null, config, secrets: { token: 't' } }))).toBe('unsupported_scope')
    expect(code(() => createPluginInstance(h.deps, { type: 'slack', scope: 'project', projectId: project.id, secrets: { botToken: 'xoxb-1' } }))).toBe('unsupported_scope')
    expect(createPluginInstance(h.deps, { type: 'slack', scope: 'global', projectId: null, secrets: { botToken: 'xoxb-1' } }).scope).toBe('global')
    expect(listPluginInstances(h.deps, { projectId: project.id }).map(i => i.type)).toEqual(['slack'])
  })

  it('allows one instance per owner for single-instance types', async () => {
    h = instanceHarness([fixturePluginType('repository'), slackPluginType, multiPluginType()])
    const [alpha, beta] = [await h.createProject('alpha'), await h.createProject('beta')]
    const repo = (projectId: string) => createPluginInstance(h.deps, { type: 'repository', scope: 'project', projectId, config, secrets: { token: 't' } })
    repo(alpha.id)
    expect(code(() => repo(alpha.id))).toBe('instance_exists')
    expect(repo(beta.id).projectId).toBe(beta.id)

    createPluginInstance(h.deps, { type: 'slack', scope: 'global', projectId: null, secrets: { botToken: 'x' } })
    expect(code(() => createPluginInstance(h.deps, { type: 'slack', scope: 'global', projectId: null, secrets: { botToken: 'y' } }))).toBe('instance_exists')

    createPluginInstance(h.deps, { type: 'codex', scope: 'project', projectId: alpha.id })
    createPluginInstance(h.deps, { type: 'codex', scope: 'project', projectId: alpha.id })
    expect(listPluginInstances(h.deps, { projectId: alpha.id })).toHaveLength(4)
  })

  it('validates config, secrets, owner and type', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    const project = await h.createProject('alpha')
    const base = { type: 'repository', scope: 'project' as const, projectId: project.id, secrets: { token: 't' } }
    expect(code(() => createPluginInstance(h.deps, { ...base, config: { account: 'Not Valid!' } }))).toBe('invalid_config')
    expect(code(() => createPluginInstance(h.deps, { ...base, config: {} }))).toBe('invalid_config')
    expect(code(() => createPluginInstance(h.deps, { ...base, config: { ...config, extra: 1 } }))).toBe('invalid_config')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, secrets: {} }))).toBe('invalid_secrets')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, secrets: { token: '' } }))).toBe('invalid_secrets')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, secrets: { token: 't', other: 'x' } }))).toBe('invalid_secrets')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, projectId: 'missing' }))).toBe('project_not_found')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, type: 'heroku' }))).toBe('type_not_found')
    expect(listPluginInstances(h.deps, { projectId: project.id })).toEqual([])
    expect(existsSync(h.secretsDir) ? readdirSync(h.secretsDir) : []).toEqual([])
  })

  it('refuses secret values while the store is locked', async () => {
    h = instanceHarness([fixturePluginType('repository'), multiPluginType()], { locked: true })
    const project = await h.createProject('alpha')
    expect(code(() => createPluginInstance(h.deps, { type: 'repository', scope: 'project', projectId: project.id, config, secrets: { token: 't' } }))).toBe('secrets_locked')
    expect(createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null }).secrets).toEqual({ apiKey: 'unset' })
  })
})

describe('updating plugin instances', () => {
  it('leaves omitted and empty secrets untouched, replaces given ones and clears null ones', async () => {
    h = instanceHarness([multiPluginType()])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null, config: { label: 'one' }, secrets: { apiKey: 'first' } }).id
    const owner = pluginSecretOwner(id)

    expect(updatePluginInstance(h.deps, id, { config: { label: 'two' } })).toMatchObject({ config: { label: 'two' }, secrets: { apiKey: 'set' } })
    expect(h.store.get(owner, 'apiKey')).toBe('first')
    updatePluginInstance(h.deps, id, { secrets: { apiKey: '' } })
    expect(h.store.get(owner, 'apiKey')).toBe('first')
    updatePluginInstance(h.deps, id, { secrets: { apiKey: 'second' } })
    expect(h.store.get(owner, 'apiKey')).toBe('second')
    expect(updatePluginInstance(h.deps, id, { secrets: { apiKey: null } }).secrets).toEqual({ apiKey: 'unset' })
    expect(updatePluginInstance(h.deps, id, { config: { label: null } }).config).toEqual({})
  })

  it('refuses to clear a required secret and rejects invalid config', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    const project = await h.createProject('alpha')
    const id = createPluginInstance(h.deps, { type: 'repository', scope: 'project', projectId: project.id, config, secrets: { token: 't' } }).id
    expect(code(() => updatePluginInstance(h.deps, id, { secrets: { token: null } }))).toBe('invalid_secrets')
    expect(code(() => updatePluginInstance(h.deps, id, { config: { host: 'gamma' } }))).toBe('invalid_config')
    expect(code(() => updatePluginInstance(h.deps, 'missing', {}))).toBe('not_found')
    expect(h.store.get(pluginSecretOwner(id), 'token')).toBe('t')
  })

  it('clears the stored health on a real change only', async () => {
    h = instanceHarness([multiPluginType()])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null, config: { label: 'one' } }).id
    await testPluginInstance(h.deps, id)
    expect(updatePluginInstance(h.deps, id, { config: { label: 'one' } }).health).toMatchObject({ healthy: true })
    expect(updatePluginInstance(h.deps, id, { secrets: { apiKey: 'k' } }).health).toBeNull()
  })
})

describe('testing a connection', () => {
  it('records healthy with its time, or the failure reason', async () => {
    let result: PluginHealth = { healthy: true, detail: 'All good.' }
    h = instanceHarness([multiPluginType(() => result)])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null }).id

    const healthy = await testPluginInstance(h.deps, id)
    expect(healthy.health).toEqual({ healthy: true, detail: 'All good.', checkedAt: expect.any(String) })
    expect(getPluginInstance(h.deps, id).health).toEqual(healthy.health)

    result = { healthy: false, reason: 'Wrong token.' }
    expect((await testPluginInstance(h.deps, id)).health).toEqual({ healthy: false, reason: 'Wrong token.', checkedAt: expect.any(String) })
  })

  it('passes the instance secrets to the check and redacts them from the reason', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    const project = await h.createProject('alpha')
    const id = createPluginInstance(h.deps, { type: 'repository', scope: 'project', projectId: project.id, config, secrets: { token: 'tok' } }).id
    expect((await testPluginInstance(h.deps, id)).health).toMatchObject({ healthy: true })

    h.close()
    h = instanceHarness([multiPluginType(({ secrets }) => {
      throw new Error(`vendor said ${secrets.get('apiKey')} is bad`)
    })])
    const other = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null, secrets: { apiKey: 'key-123' } }).id
    expect((await testPluginInstance(h.deps, other)).health).toMatchObject({ healthy: false, reason: 'vendor said [redacted] is bad' })
  })

  it('records an unhealthy result when the stored config no longer validates', async () => {
    h = instanceHarness([multiPluginType()])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null }).id
    h.database.db.update(pluginInstances).set({ config: { gone: 'x' } }).where(eq(pluginInstances.id, id)).run()
    expect((await testPluginInstance(h.deps, id)).health).toMatchObject({ healthy: false, reason: expect.stringContaining('no longer valid') })
  })

  it('does not store a result for config that changed while the check ran', async () => {
    let id = ''
    h = instanceHarness([multiPluginType(async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      updatePluginInstance(h.deps, id, { config: { label: 'changed' } })
      return { healthy: true }
    })])
    id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null }).id
    await expect(testPluginInstance(h.deps, id)).rejects.toMatchObject({ code: 'instance_changed' })
    expect(getPluginInstance(h.deps, id).health).toBeNull()
  })
})

describe('deleting plugin instances', () => {
  it('removes the row and its secrets', async () => {
    h = instanceHarness([multiPluginType()])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null, secrets: { apiKey: 'k' } }).id
    expect(existsSync(join(h.secretsDir, pluginSecretOwner(id)))).toBe(true)
    await deletePluginInstance(h.deps, id)
    expect(h.store.isSet(pluginSecretOwner(id), 'apiKey')).toBe(false)
    expect(existsSync(join(h.secretsDir, pluginSecretOwner(id)))).toBe(false)
    expect(code(() => getPluginInstance(h.deps, id))).toBe('not_found')
    await expect(deletePluginInstance(h.deps, id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('removes a project\'s instances and secrets but keeps global ones', async () => {
    h = instanceHarness([multiPluginType()])
    const project = await h.createProject('alpha')
    const own = createPluginInstance(h.deps, { type: 'codex', scope: 'project', projectId: project.id, secrets: { apiKey: 'a' } }).id
    const global = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null, secrets: { apiKey: 'g' } }).id
    expect(await deleteProjectPluginInstances(h.deps, project.id)).toBe(1)
    expect(h.store.isSet(pluginSecretOwner(own), 'apiKey')).toBe(false)
    expect(h.store.get(pluginSecretOwner(global), 'apiKey')).toBe('g')
  })

  it('runs the type\'s onDelete hook first, with the instance, paths and secrets', async () => {
    const seen: { id: string, apiKey: string | undefined, rowExists: boolean, paths: unknown }[] = []
    h = instanceHarness([{
      ...multiPluginType(),
      onDelete({ instance, paths, secrets }) {
        seen.push({ id: instance.id, apiKey: secrets.get('apiKey'), rowExists: findPluginInstance(h.deps, instance.id) !== null, paths })
      },
    }])
    const project = await h.createProject('alpha')
    const one = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null, secrets: { apiKey: 'k' } }).id
    const two = createPluginInstance(h.deps, { type: 'codex', scope: 'project', projectId: project.id, secrets: { apiKey: 'p' } }).id
    await deletePluginInstance(h.deps, one)
    await deleteProjectPluginInstances(h.deps, project.id)
    expect(seen).toEqual([
      { id: one, apiKey: 'k', rowExists: true, paths: h.deps.paths },
      { id: two, apiKey: 'p', rowExists: true, paths: h.deps.paths },
    ])
  })

  it('keeps the instance when the onDelete hook throws', async () => {
    h = instanceHarness([{ ...multiPluginType(), onDelete: () => Promise.reject(new Error('disk says no')) }])
    const project = await h.createProject('alpha')
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'project', projectId: project.id, secrets: { apiKey: 'k' } }).id
    await expect(deletePluginInstance(h.deps, id)).rejects.toThrow('disk says no')
    await expect(deleteProjectPluginInstances(h.deps, project.id)).rejects.toThrow('disk says no')
    expect(getPluginInstance(h.deps, id).secrets).toEqual({ apiKey: 'set' })
  })
})

describe('refreshing and resetting stored health', () => {
  it('stores the check like a test, returns null when the instance is gone, and resets', async () => {
    h = instanceHarness([multiPluginType(() => ({ healthy: true, detail: 'ok' }))])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null }).id
    expect(await refreshPluginInstanceHealth(h.deps, id)).toEqual({ healthy: true, detail: 'ok', checkedAt: expect.any(String) })
    expect(getPluginInstance(h.deps, id).health).toMatchObject({ healthy: true })
    resetPluginInstanceHealth(h.deps, id)
    expect(getPluginInstance(h.deps, id).health).toBeNull()
    await deletePluginInstance(h.deps, id)
    expect(await refreshPluginInstanceHealth(h.deps, id)).toBeNull()
  })
})

describe('resolving a project\'s instance of a type', () => {
  it('prefers the project\'s own instance and falls back to the global one', async () => {
    h = instanceHarness([multiPluginType(), fixturePluginType('repository')])
    const [alpha, beta] = [await h.createProject('alpha'), await h.createProject('beta')]
    const global = createPluginInstance(h.deps, { type: 'codex', scope: 'global', projectId: null }).id
    const own = createPluginInstance(h.deps, { type: 'codex', scope: 'project', projectId: alpha.id }).id
    expect(resolvePluginInstance(h.deps, alpha.id, 'codex')?.id).toBe(own)
    expect(resolvePluginInstance(h.deps, beta.id, 'codex')?.id).toBe(global)
    expect(resolvePluginInstance(h.deps, beta.id, 'repository')).toBeNull()
  })
})
