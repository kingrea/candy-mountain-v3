import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginHealth } from '@candy-mountain/platform-sdk'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { pluginInstances } from '../../db/schema'
import { fixturePluginType, globalPluginType } from '../fixtures'
import { pluginSecretOwner } from '../secrets'
import { PluginInstanceError } from './errors'
import {
  createPluginInstance,
  deletePluginInstance,
  deleteWorkspacePluginInstances,
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

/** Commits at once: the after-commit work runs as soon as the rows are gone. */
async function deleteCommitted(deps: InstanceHarness['deps'], workspaceId: string): Promise<number> {
  const cleanups: (() => void | Promise<void>)[] = []
  const removed = await deleteWorkspacePluginInstances(deps, workspaceId, { afterCommit: task => void cleanups.push(task) })
  for (const task of cleanups) await task()
  return removed
}

describe('creating plugin instances', () => {
  it('stores secrets encrypted and only ever reports them as set', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    const workspace = await h.createWorkspace('alpha')
    const created = createPluginInstance(h.deps, { type: 'repository', scope: 'workspace', workspaceId: workspace.id, config, secrets: { token: 'tok-SUPER-secret' } })

    expect(created).toMatchObject({ type: 'repository', scope: 'workspace', workspaceId: workspace.id, workspaceSlug: 'alpha', config: { host: 'alpha', account: 'jack' }, secrets: { token: 'set' }, health: null })
    const file = join(h.secretsDir, pluginSecretOwner(created.id), 'token.json')
    expect(readFileSync(file, 'utf8')).not.toContain('tok-SUPER-secret')
    expect(h.store.get(pluginSecretOwner(created.id), 'token')).toBe('tok-SUPER-secret')
    for (const view of [created, getPluginInstance(h.deps, created.id), ...listPluginInstances(h.deps, { workspaceId: workspace.id })]) {
      expect(JSON.stringify(view)).not.toContain('tok-SUPER-secret')
      expect(view.secrets).toEqual({ token: 'set' })
    }
  })

  it('rejects a scope the type does not support', async () => {
    h = instanceHarness([fixturePluginType('repository'), globalPluginType()])
    const workspace = await h.createWorkspace('alpha')
    expect(code(() => createPluginInstance(h.deps, { type: 'repository', scope: 'global', workspaceId: null, config, secrets: { token: 't' } }))).toBe('unsupported_scope')
    expect(code(() => createPluginInstance(h.deps, { type: 'pager', scope: 'workspace', workspaceId: workspace.id, secrets: { botToken: 'xoxb-1' } }))).toBe('unsupported_scope')
    expect(createPluginInstance(h.deps, { type: 'pager', scope: 'global', workspaceId: null, secrets: { botToken: 'xoxb-1' } }).scope).toBe('global')
    expect(listPluginInstances(h.deps, { workspaceId: workspace.id }).map(i => i.type)).toEqual(['pager'])
  })

  it('allows one instance per owner for single-instance types', async () => {
    h = instanceHarness([fixturePluginType('repository'), globalPluginType(), multiPluginType()])
    const [alpha, beta] = [await h.createWorkspace('alpha'), await h.createWorkspace('beta')]
    const repo = (workspaceId: string) => createPluginInstance(h.deps, { type: 'repository', scope: 'workspace', workspaceId, config, secrets: { token: 't' } })
    repo(alpha.id)
    expect(code(() => repo(alpha.id))).toBe('instance_exists')
    expect(() => repo(alpha.id)).toThrow('This workspace already has a Fixture repository instance')
    const project = { singular: 'project', plural: 'projects', singularTitle: 'Project', pluralTitle: 'Projects' }
    expect(() => createPluginInstance(h.deps, { type: 'repository', scope: 'workspace', workspaceId: alpha.id, config, secrets: { token: 't' } }, project)).toThrow('This project already has a Fixture repository instance')
    expect(repo(beta.id).workspaceId).toBe(beta.id)

    createPluginInstance(h.deps, { type: 'pager', scope: 'global', workspaceId: null, secrets: { botToken: 'x' } })
    expect(code(() => createPluginInstance(h.deps, { type: 'pager', scope: 'global', workspaceId: null, secrets: { botToken: 'y' } }))).toBe('instance_exists')

    createPluginInstance(h.deps, { type: 'codex', scope: 'workspace', workspaceId: alpha.id })
    createPluginInstance(h.deps, { type: 'codex', scope: 'workspace', workspaceId: alpha.id })
    expect(listPluginInstances(h.deps, { workspaceId: alpha.id })).toHaveLength(4)
  })

  it('validates config, secrets, owner and type', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    const workspace = await h.createWorkspace('alpha')
    const base = { type: 'repository', scope: 'workspace' as const, workspaceId: workspace.id, secrets: { token: 't' } }
    expect(code(() => createPluginInstance(h.deps, { ...base, config: { account: 'Not Valid!' } }))).toBe('invalid_config')
    expect(code(() => createPluginInstance(h.deps, { ...base, config: {} }))).toBe('invalid_config')
    expect(code(() => createPluginInstance(h.deps, { ...base, config: { ...config, extra: 1 } }))).toBe('invalid_config')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, secrets: {} }))).toBe('invalid_secrets')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, secrets: { token: '' } }))).toBe('invalid_secrets')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, secrets: { token: 't', other: 'x' } }))).toBe('invalid_secrets')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, workspaceId: 'missing' }))).toBe('workspace_not_found')
    expect(code(() => createPluginInstance(h.deps, { ...base, config, type: 'heroku' }))).toBe('type_not_found')
    expect(listPluginInstances(h.deps, { workspaceId: workspace.id })).toEqual([])
    expect(existsSync(h.secretsDir) ? readdirSync(h.secretsDir) : []).toEqual([])
  })

  it('refuses secret values while the store is locked', async () => {
    h = instanceHarness([fixturePluginType('repository'), multiPluginType()], { locked: true })
    const workspace = await h.createWorkspace('alpha')
    expect(code(() => createPluginInstance(h.deps, { type: 'repository', scope: 'workspace', workspaceId: workspace.id, config, secrets: { token: 't' } }))).toBe('secrets_locked')
    expect(createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null }).secrets).toEqual({ apiKey: 'unset' })
  })
})

describe('updating plugin instances', () => {
  it('leaves omitted and empty secrets untouched, replaces given ones and clears null ones', async () => {
    h = instanceHarness([multiPluginType()])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null, config: { label: 'one' }, secrets: { apiKey: 'first' } }).id
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
    const workspace = await h.createWorkspace('alpha')
    const id = createPluginInstance(h.deps, { type: 'repository', scope: 'workspace', workspaceId: workspace.id, config, secrets: { token: 't' } }).id
    expect(code(() => updatePluginInstance(h.deps, id, { secrets: { token: null } }))).toBe('invalid_secrets')
    expect(code(() => updatePluginInstance(h.deps, id, { config: { host: 'gamma' } }))).toBe('invalid_config')
    expect(code(() => updatePluginInstance(h.deps, 'missing', {}))).toBe('not_found')
    expect(h.store.get(pluginSecretOwner(id), 'token')).toBe('t')
  })

  it('clears the stored health on a real change only', async () => {
    h = instanceHarness([multiPluginType()])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null, config: { label: 'one' } }).id
    await testPluginInstance(h.deps, id)
    expect(updatePluginInstance(h.deps, id, { config: { label: 'one' } }).health).toMatchObject({ healthy: true })
    expect(updatePluginInstance(h.deps, id, { secrets: { apiKey: 'k' } }).health).toBeNull()
  })
})

describe('testing a connection', () => {
  it('records healthy with its time, or the failure reason', async () => {
    let result: PluginHealth = { healthy: true, detail: 'All good.' }
    h = instanceHarness([multiPluginType(() => result)])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null }).id

    const healthy = await testPluginInstance(h.deps, id)
    expect(healthy.health).toEqual({ healthy: true, detail: 'All good.', checkedAt: expect.any(String) })
    expect(getPluginInstance(h.deps, id).health).toEqual(healthy.health)

    result = { healthy: false, reason: 'Wrong token.' }
    expect((await testPluginInstance(h.deps, id)).health).toEqual({ healthy: false, reason: 'Wrong token.', checkedAt: expect.any(String) })
  })

  it('passes the instance secrets to the check and redacts them from the reason', async () => {
    h = instanceHarness([fixturePluginType('repository')])
    const workspace = await h.createWorkspace('alpha')
    const id = createPluginInstance(h.deps, { type: 'repository', scope: 'workspace', workspaceId: workspace.id, config, secrets: { token: 'tok' } }).id
    expect((await testPluginInstance(h.deps, id)).health).toMatchObject({ healthy: true })

    h.close()
    h = instanceHarness([multiPluginType(({ secrets }) => {
      throw new Error(`vendor said ${secrets.get('apiKey')} is bad`)
    })])
    const other = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null, secrets: { apiKey: 'key-123' } }).id
    expect((await testPluginInstance(h.deps, other)).health).toMatchObject({ healthy: false, reason: 'vendor said [redacted] is bad' })
  })

  it('records an unhealthy result when the stored config no longer validates', async () => {
    h = instanceHarness([multiPluginType()])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null }).id
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
    id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null }).id
    await expect(testPluginInstance(h.deps, id)).rejects.toMatchObject({ code: 'instance_changed' })
    expect(getPluginInstance(h.deps, id).health).toBeNull()
  })
})

describe('deleting plugin instances', () => {
  it('removes the row and its secrets', async () => {
    h = instanceHarness([multiPluginType()])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null, secrets: { apiKey: 'k' } }).id
    expect(existsSync(join(h.secretsDir, pluginSecretOwner(id)))).toBe(true)
    await deletePluginInstance(h.deps, id)
    expect(h.store.isSet(pluginSecretOwner(id), 'apiKey')).toBe(false)
    expect(existsSync(join(h.secretsDir, pluginSecretOwner(id)))).toBe(false)
    expect(code(() => getPluginInstance(h.deps, id))).toBe('not_found')
    await expect(deletePluginInstance(h.deps, id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('removes a workspace\'s instances and secrets but keeps global ones', async () => {
    h = instanceHarness([multiPluginType()])
    const workspace = await h.createWorkspace('alpha')
    const own = createPluginInstance(h.deps, { type: 'codex', scope: 'workspace', workspaceId: workspace.id, secrets: { apiKey: 'a' } }).id
    const global = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null, secrets: { apiKey: 'g' } }).id
    expect(await deleteCommitted(h.deps, workspace.id)).toBe(1)
    expect(h.store.isSet(pluginSecretOwner(own), 'apiKey')).toBe(false)
    expect(h.store.get(pluginSecretOwner(global), 'apiKey')).toBe('g')
  })

  it('leaves a workspace\'s secrets until the deletion commits, since a rollback cannot restore files', async () => {
    h = instanceHarness([multiPluginType()])
    const workspace = await h.createWorkspace('alpha')
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'workspace', workspaceId: workspace.id, secrets: { apiKey: 'a' } }).id
    const cleanups: (() => void | Promise<void>)[] = []
    await deleteWorkspacePluginInstances(h.deps, workspace.id, { afterCommit: task => void cleanups.push(task) })
    expect(findPluginInstance(h.deps, id)).toBeNull()
    expect(h.store.get(pluginSecretOwner(id), 'apiKey')).toBe('a')
    for (const task of cleanups) await task()
    expect(h.store.isSet(pluginSecretOwner(id), 'apiKey')).toBe(false)
  })

  it('runs the type\'s onDelete hook first, with the instance, paths and secrets', async () => {
    const seen: { id: string, apiKey: string | undefined, rowExists: boolean, paths: unknown }[] = []
    h = instanceHarness([{
      ...multiPluginType(),
      onDelete({ instance, paths, secrets }) {
        seen.push({ id: instance.id, apiKey: secrets.get('apiKey'), rowExists: findPluginInstance(h.deps, instance.id) !== null, paths })
      },
    }])
    const workspace = await h.createWorkspace('alpha')
    const one = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null, secrets: { apiKey: 'k' } }).id
    const two = createPluginInstance(h.deps, { type: 'codex', scope: 'workspace', workspaceId: workspace.id, secrets: { apiKey: 'p' } }).id
    await deletePluginInstance(h.deps, one)
    await deleteCommitted(h.deps, workspace.id)
    expect(seen).toEqual([
      { id: one, apiKey: 'k', rowExists: true, paths: h.deps.paths },
      { id: two, apiKey: 'p', rowExists: true, paths: h.deps.paths },
    ])
  })

  it('keeps the instance when the onDelete hook throws', async () => {
    h = instanceHarness([{ ...multiPluginType(), onDelete: () => Promise.reject(new Error('disk says no')) }])
    const workspace = await h.createWorkspace('alpha')
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'workspace', workspaceId: workspace.id, secrets: { apiKey: 'k' } }).id
    await expect(deletePluginInstance(h.deps, id)).rejects.toThrow('disk says no')
    await expect(deleteCommitted(h.deps, workspace.id)).rejects.toThrow('disk says no')
    expect(getPluginInstance(h.deps, id).secrets).toEqual({ apiKey: 'set' })
  })
})

describe('refreshing and resetting stored health', () => {
  it('stores the check like a test, returns null when the instance is gone, and resets', async () => {
    h = instanceHarness([multiPluginType(() => ({ healthy: true, detail: 'ok' }))])
    const id = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null }).id
    expect(await refreshPluginInstanceHealth(h.deps, id)).toEqual({ healthy: true, detail: 'ok', checkedAt: expect.any(String) })
    expect(getPluginInstance(h.deps, id).health).toMatchObject({ healthy: true })
    resetPluginInstanceHealth(h.deps, id)
    expect(getPluginInstance(h.deps, id).health).toBeNull()
    await deletePluginInstance(h.deps, id)
    expect(await refreshPluginInstanceHealth(h.deps, id)).toBeNull()
  })
})

describe('resolving a workspace\'s instance of a type', () => {
  it('prefers the workspace\'s own instance and falls back to the global one', async () => {
    h = instanceHarness([multiPluginType(), fixturePluginType('repository')])
    const [alpha, beta] = [await h.createWorkspace('alpha'), await h.createWorkspace('beta')]
    const global = createPluginInstance(h.deps, { type: 'codex', scope: 'global', workspaceId: null }).id
    const own = createPluginInstance(h.deps, { type: 'codex', scope: 'workspace', workspaceId: alpha.id }).id
    expect(resolvePluginInstance(h.deps, alpha.id, 'codex')?.id).toBe(own)
    expect(resolvePluginInstance(h.deps, beta.id, 'codex')?.id).toBe(global)
    expect(resolvePluginInstance(h.deps, beta.id, 'repository')).toBeNull()
  })
})
