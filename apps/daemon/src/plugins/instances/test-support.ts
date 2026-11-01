import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, PluginHealth, Project } from '@candy-mountain/shared'
import type { AppDeps } from '../../app'
import { createTestApp } from '../../testing/platform'
import type { AuthStrategy } from '../../auth'
import { dataPaths, type DataPaths } from '../../data-dir'
import type { PlatformDatabase } from '../../db'
import { createProject } from '../../projects/projects'
import { createSecretsStore, lockedSecretsStore, MasterKey, type SecretsStore } from '../../secrets'
import { openTestDatabase } from '../../testing'
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
    scopes: ['project', 'global'],
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
  createProject(slug: string): Promise<Project>
  app(roles?: string[], runtime?: AppDeps['runtime']): ReturnType<typeof createTestApp>
  close(): void
}

export function instanceHarness(types: readonly AnyPluginType[], { locked = false } = {}): InstanceHarness {
  const root = mkdtempSync(join(tmpdir(), 'candy-mountain-instances-'))
  const secretsDir = join(root, 'secrets')
  const database = openTestDatabase()
  const store = locked ? lockedSecretsStore() : createSecretsStore(secretsDir, MasterKey.generate())
  const pluginTypes = createPluginTypeRegistry(types)
  const paths = dataPaths(root)
  const as = (roles: string[]): AuthStrategy => ({ name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) })
  return {
    database,
    store,
    secretsDir,
    deps: { db: database.db, pluginTypes, secrets: store.writeOnly, secretsReader: store, paths },
    async createProject(slug) {
      const path = join(root, 'repos', slug)
      mkdirSync(path, { recursive: true })
      return createProject(database.db, { name: slug, slug, source: { kind: 'local-path', path } })
    },
    app: (roles = ['admin'], runtime?) => createTestApp({ db: database.db, paths, auth: as(roles), pluginTypes, secrets: store.writeOnly, secretsReader: store, runtime }),
    close() {
      database.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
