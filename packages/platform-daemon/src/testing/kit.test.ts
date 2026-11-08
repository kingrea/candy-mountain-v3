import { existsSync } from 'node:fs'
import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '../app'
import { fixtureCapability, fixtureDefinition } from '../capabilities/fixtures'
import { fixturePluginType, globalPluginType } from '../plugins/fixtures'
import { pluginSecretOwner } from '../plugins/secrets'
import { requireCapability } from '../registry/gate'
import { SecretsLockedError } from '../secrets'
import { TEST_ACTOR_HEADER, TEST_FACTS_ID, testKit, type TestKit } from './kit'
import { testProduct } from './product'

/** One gated route: the view 'alpha-home' sits on the 'read' and 'full' rungs of the fixture ladder, never on 'none'. */
const routes = () => new Hono<AppEnv>().get('/:slug/alpha', requireCapability({ capability: 'alpha', view: 'alpha-home' }), c => c.json({ actor: c.var.actor.username }))

const alpha = ({ plugins = [], facts = [] }: { plugins?: string[], facts?: string[] } = {}) =>
  fixtureDefinition('alpha', { manifest: { ...fixtureCapability('alpha', plugins), requiresWorkspaceFacts: facts }, start: () => ({ workspaceRoutes: [routes()] }) })

const errorCode = async (res: Response) => ((await res.json()) as ApiErrorBody).error.code

let kit: TestKit | undefined
afterEach(async () => {
  await kit?.close()
  kit = undefined
})

describe('testKit', () => {
  it('starts the platform definitions plus the named ones in a temporary directory, serves their routes, and removes everything on close', async () => {
    kit = testKit({ capabilities: [alpha()] })
    const { root } = kit.platform.paths
    expect(existsSync(root)).toBe(true)
    expect(kit.platform.capabilities.list().map(cap => cap.id)).toEqual(['alpha'])
    expect(kit.platform.migrationSets.map(set => set.id)).toEqual(['platform'])
    expect(kit.platform.secrets.unlocked).toBe(true)

    const workspace = kit.workspace()
    const res = await kit.admin.request(`${WORKSPACES_PATH}/${workspace.slug}/alpha`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ actor: 'admin' })

    await kit.close()
    kit = undefined
    expect(existsSync(root)).toBe(false)
  })

  it('admits an actor at the rung that shows the view and refuses one at a lower rung', async () => {
    kit = testKit({ capabilities: [alpha()] })
    const { slug } = kit.workspace()
    const reader = kit.actor({ rungs: { alpha: 'read' } })
    const nobody = kit.actor()

    expect(reader.actor).toMatchObject({ username: 'actor-2', roles: ['actor-2-role'] })
    const admitted = await reader.request(`${WORKSPACES_PATH}/${slug}/alpha`)
    expect(admitted.status).toBe(200)
    expect(await admitted.json()).toEqual({ actor: 'actor-2' })

    const refused = await nobody.request(`${WORKSPACES_PATH}/${slug}/alpha`)
    expect(refused.status).toBe(403)
    expect(await errorCode(refused)).toBe('not_granted')

    expect((await kit.app.request(`${WORKSPACES_PATH}/${slug}/alpha`)).status).toBe(401)
    expect((await kit.app.request(`${WORKSPACES_PATH}/${slug}/alpha`, { headers: reader.headers })).status).toBe(200)
    expect((await kit.app.request(`${WORKSPACES_PATH}/${slug}/alpha`, { headers: { [TEST_ACTOR_HEADER]: 'ghost' } })).status).toBe(401)
  })

  it('refuses a bad rung by name', () => {
    kit = testKit({ capabilities: [alpha()] })
    expect(() => kit!.actor({ rungs: { alpha: 'owner' } })).toThrow("'owner' is not a rung of capability 'alpha' (none, read, full)")
  })

  it('makes a workspace with chosen facts and chosen modules', async () => {
    const module = { id: 'ops', label: 'Ops', description: 'Ops.', icon: 'i-lucide-activity', capabilities: [{ capabilityId: 'alpha', defaultRung: 'read' }] }
    kit = testKit({ capabilities: [alpha({ facts: ['hasThing'] })], modules: [module], facts: ['hasThing'] })
    expect(kit.platform.capabilities.definitions().map(d => d.id)).toContain(TEST_FACTS_ID)
    const path = (slug: string) => `${WORKSPACES_PATH}/${slug}/alpha`

    const bare = kit.workspace({ name: 'Bare' })
    const notReady = await kit.admin.request(path(bare.slug))
    expect(notReady.status).toBe(409)
    expect(((await notReady.json()) as ApiErrorBody).error.message).toContain("The workspace lacks 'hasThing'.")

    const ready = kit.workspace({ name: 'Ready', slug: 'ready', facts: { hasThing: true } })
    expect(ready.slug).toBe('ready')
    expect((await kit.admin.request(path('ready'))).status).toBe(200)

    const off = kit.workspace({ facts: { hasThing: true }, modules: [] })
    const disabled = await kit.admin.request(path(off.slug))
    expect(disabled.status).toBe(404)
    expect(await errorCode(disabled)).toBe('not_enabled')
  })

  it('overrides a fact a listed definition computes', async () => {
    const declaring = fixtureDefinition('things', { manifest: null, workspaceFacts: [{ id: 'hasThing', compute: () => false, message: () => 'No things.' }] })
    kit = testKit({ capabilities: [declaring, alpha({ facts: ['hasThing'] })] })
    expect(kit.platform.capabilities.definitions().map(d => d.id)).not.toContain(TEST_FACTS_ID)
    const { slug } = kit.workspace({ facts: { hasThing: true } })
    expect((await kit.admin.request(`${WORKSPACES_PATH}/${slug}/alpha`)).status).toBe(200)
  })

  it('creates a plugin instance with fake secrets and stored health, with no secrets key of the test\'s own', async () => {
    kit = testKit({ capabilities: [alpha({ plugins: ['probe'] })], pluginTypes: [fixturePluginType('probe'), globalPluginType('pager')] })
    const workspace = kit.workspace()
    const path = `${WORKSPACES_PATH}/${workspace.slug}/alpha`

    const missing = await kit.admin.request(path)
    expect(missing.status).toBe(409)
    expect(await errorCode(missing)).toBe('not_ready')

    const untested = kit.pluginInstance({ type: 'probe', workspace, config: { account: 'acme' }, health: null })
    expect(untested).toMatchObject({ type: 'probe', scope: 'workspace', workspaceId: workspace.id, config: { account: 'acme', host: 'alpha' }, secrets: { token: 'set' }, health: null })
    expect(kit.platform.secrets.get(pluginSecretOwner(untested.id), 'token')).toBe('fake-token')
    expect((await kit.admin.request(path)).status).toBe(409)

    const other = kit.workspace()
    const healthy = kit.pluginInstance({ type: 'probe', workspace: other, config: { account: 'acme' }, secrets: { token: 'given' } })
    expect(healthy).toMatchObject({ workspaceId: other.id, health: { healthy: true } })
    expect(kit.platform.secrets.get(pluginSecretOwner(healthy.id), 'token')).toBe('given')
    expect((await kit.admin.request(`${WORKSPACES_PATH}/${other.slug}/alpha`)).status).toBe(200)

    expect(kit.deps.secretsReader.get(pluginSecretOwner(healthy.id), 'token')).toBe('given')
    expect(kit.deps.pluginTypes.byId('probe')).toBeDefined()

    const global = kit.pluginInstance({ type: 'pager' })
    expect(global).toMatchObject({ type: 'pager', scope: 'global', workspaceId: null, secrets: { botToken: 'set' } })

    expect(() => kit!.pluginInstance({ type: 'nope' })).toThrow("Plugin type 'nope' is not registered")
  })

  it('can start with secrets locked', () => {
    kit = testKit({ pluginTypes: [fixturePluginType('probe')], lockedSecrets: true })
    expect(kit.platform.secrets.unlocked).toBe(false)
    const workspace = kit.workspace()
    expect(() => kit!.pluginInstance({ type: 'probe', workspace, config: { account: 'acme' } })).toThrow('Secrets are locked')
    expect(() => kit!.platform.secrets.get('x', 'y')).toThrow(SecretsLockedError)
  })

  it('restarts over the same data directory and secrets key, keeping users, workspaces, secrets and fact overrides', async () => {
    kit = testKit({ capabilities: [alpha({ plugins: ['probe'], facts: ['hasThing'] })], pluginTypes: [fixturePluginType('probe')], facts: ['hasThing'] })
    const first = kit
    const { root } = first.platform.paths
    const workspace = first.workspace({ slug: 'kept', facts: { hasThing: true } })
    const instance = first.pluginInstance({ type: 'probe', workspace, config: { account: 'acme' } })
    const reader = first.actor({ rungs: { alpha: 'read' } })

    kit = await first.restart()
    expect(kit.platform.paths.root).toBe(root)
    expect(existsSync(root)).toBe(true)
    expect(kit.platform.secrets.get(pluginSecretOwner(instance.id), 'token')).toBe('fake-token')
    expect((await kit.as(reader.actor.username).request(`${WORKSPACES_PATH}/kept/alpha`)).status).toBe(200)
    expect(kit.actor().actor.username).not.toBe(reader.actor.username)
    expect(() => kit!.as('ghost')).toThrow("No user 'ghost'.")
    await expect(first.restart()).rejects.toThrow('This kit is closed')

    await first.close()
    expect(existsSync(root)).toBe(true)
    await kit.close()
    kit = undefined
    expect(existsSync(root)).toBe(false)
  })

  it('refuses facts alongside a whole product', () => {
    expect(() => testKit({ product: testProduct(), facts: ['x'] })).toThrow('name the parts rather than a product')
  })
})
