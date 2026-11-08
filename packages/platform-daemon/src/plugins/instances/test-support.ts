import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, CreateWorkspaceRequest, PluginHealth, Workspace } from '@candy-mountain/platform-sdk'
import type { AppDeps } from '../../app'
import type { AuthStrategy } from '../../auth'
import { dataPaths, type DataPaths } from '../../data-dir'
import type { Db, PlatformDatabase } from '../../db'
import type { Product } from '../../product'
import { createSecretsStore, lockedSecretsStore, MasterKey, type SecretsStore } from '../../secrets'
import { createTestApp, openTestDatabase } from '../../testing/platform'
import { createWorkspace } from '../../workspaces'
import { definePluginType, type AnyPluginType, type PluginHealthContext } from '../definition'
import { createPluginTypeRegistry } from '../registry'
import type { PluginInstanceDeps } from './instances'

/** Supports both scopes and several instances per owner; `apiKey` is optional so it can be cleared. */
export function multiPluginType(health: (context: PluginHealthContext) => PluginHealth | Promise<PluginHealth> = () => ({ healthy: true })): AnyPluginType {
  return definePluginType({
    id: 'codex',
    name: 'Multi',
    description: 'Test fixture with both scopes.',
    reach: ['Nothing real.'],
    scopes: ['workspace', 'global'],
    singleInstance: false,
    configFields: [{ kind: 'string', name: 'label', label: 'Label' }],
    secretFields: [{ name: 'apiKey', label: 'API key' }],
    healthCheck: context => health(context),
  })
}

export interface InstanceHarness {
  database: PlatformDatabase
  store: SecretsStore
  secretsDir: string
  deps: PluginInstanceDeps & { secretsReader: SecretsStore, paths: DataPaths }
  /** A workspace over a fresh directory under the harness root, created the way the harness was told to. */
  createWorkspace(slug: string): Promise<Workspace>
  app(roles?: string[], runtime?: AppDeps['runtime'], product?: Product): ReturnType<typeof createTestApp>
  close(): void
}

export interface InstanceHarnessOptions {
  locked?: boolean
  /** What `app` serves unless a call names another; a product's tests hand in their own. */
  product?: Product
  /** Defaults to the platform's tables alone. */
  openDatabase?: () => PlatformDatabase
  /** How a workspace row is made from its directory; a product's tests give it the checkout a capability needs. */
  createWorkspace?: (db: Db, input: CreateWorkspaceRequest & { path: string }) => Workspace | Promise<Workspace>
}

export function instanceHarness(types: readonly AnyPluginType[], { locked = false, product, openDatabase = openTestDatabase, createWorkspace: makeWorkspace = (db, { name, slug }) => createWorkspace(db, { name, slug }) }: InstanceHarnessOptions = {}): InstanceHarness {
  const root = mkdtempSync(join(tmpdir(), 'platform-instances-'))
  const secretsDir = join(root, 'secrets')
  const database = openDatabase()
  const store = locked ? lockedSecretsStore() : createSecretsStore(secretsDir, MasterKey.generate())
  const pluginTypes = createPluginTypeRegistry(types)
  const paths = dataPaths(root)
  const as = (roles: string[]): AuthStrategy => ({ name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) })
  return {
    database,
    store,
    secretsDir,
    deps: { db: database.db, pluginTypes, secrets: store.writeOnly, secretsReader: store, paths },
    async createWorkspace(slug) {
      const path = join(root, 'repos', slug)
      mkdirSync(path, { recursive: true })
      return makeWorkspace(database.db, { name: slug, slug, path })
    },
    app: (roles = ['admin'], runtime?, served = product) => createTestApp({ db: database.db, paths, auth: as(roles), pluginTypes, secrets: store.writeOnly, secretsReader: store, runtime, product: served }),
    close() {
      database.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
