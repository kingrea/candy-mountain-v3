import { randomUUID } from 'node:crypto'
import { ADMIN_USERNAME, type Actor, type PluginHealth, type PluginInstance, type PluginSecretValues, type Workspace } from '@candy-mountain/platform-sdk'
import type { WorkspaceFactRegistry } from '@candy-mountain/platform-sdk/daemon'
import { eq } from 'drizzle-orm'
import type { createApp } from '../app'
import { findActorByUsername } from '../auth/actors'
import { trustedHeaderStrategy } from '../auth/trusted-header'
import { defineCapabilityDefinition } from '../capabilities/definition'
import type { DataPaths } from '../data-dir'
import type { Db } from '../db'
import { pluginInstances, roles, userRoles, users } from '../db/schema'
import { setGrant } from '../grants/grants'
import type { Platform } from '../platform'
import { createPluginInstance, getPluginInstance, type PluginInstanceDeps, type SecretsReader } from '../plugins/instances/instances'
import { MasterKey } from '../secrets'
import { setEnabledModules } from '../workspace-modules/enablement'
import { createWorkspace } from '../workspaces/workspaces'
import { createTempDataDir, platformApp, startTestPlatform, type TempDataDir, type TestPlatformOptions } from './platform'

/** The request header the kit's app reads the actor's username from. */
export const TEST_ACTOR_HEADER = 'x-test-actor'

/** The service-only definition the kit adds to declare the facts a test names. */
export const TEST_FACTS_ID = 'test-facts'

export interface TestActor {
  actor: Actor
  /** Names the actor to the kit's app; spread into a request's headers. */
  headers: Readonly<Record<string, string>>
  /** `app.request` with the actor's header set. */
  request(path: string, init?: RequestInit): Promise<Response>
}

export interface TestActorOptions {
  /** Rung by capability id, granted through a role of the actor's own; a capability left out resolves to its `everyoneRung` or 'none'. */
  rungs?: Readonly<Record<string, string>>
  /** Generated when absent; every call makes a new user. */
  username?: string
}

export interface TestWorkspaceOptions {
  name?: string
  slug?: string
  /** What the registry and the gates see for this workspace, over whatever the definitions compute. */
  facts?: Readonly<Record<string, boolean>>
  /** Module ids to enable; every registered module when absent. */
  modules?: readonly string[]
}

export interface TestPluginInstanceOptions {
  type: string
  /** A workspace instance when given, else a global one. */
  workspace?: Pick<Workspace, 'id'>
  config?: Record<string, unknown>
  /** Every secret field the type declares is filled with a fake value unless named here; null leaves one unset. */
  secrets?: PluginSecretValues
  /** Stored as the instance's last check without running the type's health check; null leaves it untested. */
  health?: PluginHealth | null
}

export interface TestDeps extends PluginInstanceDeps {
  secretsReader: SecretsReader
  paths: DataPaths
}

export interface TestKitOptions extends TestPlatformOptions {
  /** Facts to declare for the manifests under test when no listed definition declares them; false until a workspace sets them. */
  facts?: readonly string[]
  /** Start with secrets locked, as a daemon without CM_SECRETS_KEY does; a throwaway key otherwise. */
  lockedSecrets?: boolean
}

export interface TestKit {
  platform: Platform
  db: Db
  /** The app a distribution would serve over the platform, with every request naming its actor through `TEST_ACTOR_HEADER`. */
  app: ReturnType<typeof createApp>
  /** The seeded administrator, who holds every capability's top rung. */
  admin: TestActor
  /** What the app hands the plugin-instance functions and a definition's services, for a test calling them directly. */
  deps: TestDeps
  actor(options?: TestActorOptions): TestActor
  workspace(options?: TestWorkspaceOptions): Workspace
  pluginInstance(options: TestPluginInstanceOptions): PluginInstance
  /** The actor for an existing user, such as one an earlier kit over the same data directory made. */
  as(username: string): TestActor
  /** Closes this kit's platform, keeping its data directory and secrets key, and starts a new kit over them with these options over the old ones; the new kit owns the directory. */
  restart(options?: TestKitOptions): Promise<TestKit>
  /** Closes the started definitions and the database, then removes the data directory. */
  close(): Promise<void>
}

/** What outlives a restart: the directory, the key, the workspaces' fact overrides and the name counter. */
interface KitState {
  dir: TempDataDir
  secretsKey: MasterKey | undefined
  factOverrides: Map<string, Record<string, boolean>>
  count: number
}

/** A platform in a temporary data directory over the platform's own definitions and the ones named, with the app a distribution would serve over it. */
export function testKit(options: TestKitOptions = {}): TestKit {
  const dir = createTempDataDir()
  try {
    return startKit({ dir, secretsKey: options.lockedSecrets ? undefined : options.secretsKey ?? MasterKey.generate(), factOverrides: new Map(), count: 0 }, options)
  }
  catch (error) {
    dir.cleanup()
    throw error
  }
}

function startKit(state: KitState, kitOptions: TestKitOptions): TestKit {
  const { facts = [], lockedSecrets = false, ...options } = kitOptions
  if (facts.length && options.product) throw new Error('testKit declares facts through the capability list, so name the parts rather than a product.')
  const { dir, factOverrides } = state
  const factsOf = (workspace: Pick<Workspace, 'id'>) => factOverrides.get(workspace.id) ?? {}
  const declared = facts.length
    ? [defineCapabilityDefinition({ id: TEST_FACTS_ID, workspaceFacts: facts.map(id => ({ id, compute: (_db: Db, workspace: Pick<Workspace, 'id'>) => factsOf(workspace)[id] === true, message: label => `The ${label.singular} lacks '${id}'.` })) })]
    : []

  const platform = startTestPlatform(dir.root, { ...options, capabilities: [...(options.capabilities ?? []), ...declared], secretsKey: lockedSecrets ? undefined : state.secretsKey })
  const { db } = platform
  const label = platform.product.config.scope.label

  // Overrides sit on the app's registry, so the gates see them while a definition's own context does not.
  const workspaceFacts: WorkspaceFactRegistry = {
    list: () => platform.workspaceFacts.list(),
    has: id => platform.workspaceFacts.has(id),
    messages: () => platform.workspaceFacts.messages(),
    compute: (db, workspace) => ({ ...platform.workspaceFacts.compute(db, workspace), ...factsOf(workspace) }),
  }
  const app = platformApp(platform, { auth: trustedHeaderStrategy(TEST_ACTOR_HEADER), workspaceFacts })

  function as(username: string): TestActor {
    const actor = findActorByUsername(db, username)
    if (!actor) throw new Error(`No user '${username}'.`)
    return {
      actor,
      headers: Object.freeze({ [TEST_ACTOR_HEADER]: username }),
      async request(path, init = {}) {
        const headers = new Headers(init.headers)
        headers.set(TEST_ACTOR_HEADER, username)
        return app.request(path, { ...init, headers })
      },
    }
  }

  let owned = true
  let closing: Promise<void> | undefined
  const close = () => closing ??= (async () => {
    try {
      await platform.close()
    }
    finally {
      if (owned) dir.cleanup()
    }
  })()

  return {
    platform,
    db,
    app,
    admin: as(ADMIN_USERNAME),
    deps: { db, paths: platform.paths, pluginTypes: platform.pluginTypes, secrets: platform.secrets.writeOnly, secretsReader: platform.secrets },
    as,
    actor({ rungs = {}, username = `actor-${++state.count}` }: TestActorOptions = {}) {
      const now = new Date().toISOString()
      const role = { id: randomUUID(), slug: `${username}-role`, name: `${username}-role`, createdAt: now, updatedAt: now }
      const user = { id: randomUUID(), username, displayName: username, createdAt: now, updatedAt: now }
      db.transaction((tx) => {
        tx.insert(users).values(user).run()
        tx.insert(roles).values(role).run()
        tx.insert(userRoles).values({ userId: user.id, roleId: role.id, createdAt: now }).run()
      })
      for (const [id, rung] of Object.entries(rungs)) setGrant(platform, { role: role.slug, target: { kind: 'capability', id }, rungs: { [id]: rung } })
      return as(username)
    },
    workspace({ name = `Workspace ${++state.count}`, slug, facts, modules }: TestWorkspaceOptions = {}) {
      const workspace = createWorkspace(db, { name, slug }, label)
      if (facts) factOverrides.set(workspace.id, { ...facts })
      setEnabledModules(db, workspace.id, modules ?? platform.modules.list().map(mod => mod.id), platform.modules)
      return workspace
    },
    pluginInstance({ type, workspace, config = {}, secrets = {}, health = { healthy: true } }: TestPluginInstanceOptions) {
      const pluginType = platform.pluginTypes.byId(type)
      if (!pluginType) throw new Error(`Plugin type '${type}' is not registered; list the definition or product plugin type that brings it.`)
      const filled: PluginSecretValues = Object.fromEntries(pluginType.secretFields.map(field => [field.name, secrets[field.name] === undefined ? `fake-${field.name}` : secrets[field.name]!]))
      const instance = createPluginInstance(platform, { type, scope: workspace ? 'workspace' : 'global', workspaceId: workspace?.id ?? null, config, secrets: filled }, label)
      if (health) db.update(pluginInstances).set({ health, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, instance.id)).run()
      return getPluginInstance(platform, instance.id)
    },
    async restart(overrides = {}) {
      if (closing) throw new Error('This kit is closed; restart the kit that replaced it.')
      owned = false
      await close()
      try {
        return startKit(state, { ...kitOptions, ...overrides })
      }
      catch (error) {
        dir.cleanup()
        throw error
      }
    },
    close,
  }
}
