import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProductConfig } from '@candy-mountain/platform-sdk'
import { createActivityEventTypeRegistry, declaredActivityEventTypes, registerActivityEventTypes } from '../activity/types'
import { createApp, type AppDeps } from '../app'
import { seedAuth } from '../auth/seed'
import { isCapabilityDefinition } from '../capabilities/definition'
import { migrationSets } from '../capabilities/migration-sets'
import type { CapabilityRegistryEntry } from '../capabilities/registry'
import { openDatabase, type PlatformDatabase } from '../db'
import { startPlatform, type Platform, type PlatformOptions } from '../platform'
import { platformDefinitions } from '../platform-capabilities'
import { suppliedIds, type Product } from '../product'

/** A product with nothing of its own; `testProduct` lists whatever parts a test supplies. */
export const TEST_PRODUCT_CONFIG: Readonly<ProductConfig> = Object.freeze({
  name: 'Test Product',
  description: 'A product for platform tests.',
  theme: { primary: 'sky', hex: '#0ea5e9' },
  scope: { label: { singular: 'workspace', plural: 'workspaces', singularTitle: 'Workspace', pluralTitle: 'Workspaces' }, urlPrefix: 'w' },
  capabilities: [],
  modules: [],
  pluginTypes: [],
  layers: [],
})

export type ProductParts = Partial<Pick<Product, 'capabilities' | 'modules' | 'pluginTypes'>>

/** The configuration's ids follow the parts, so only the parts themselves are validated. */
export function testProduct({ capabilities = [], modules = [], pluginTypes = [] }: ProductParts = {}, config: Partial<ProductConfig> = {}): Product {
  const parts = { capabilities, modules, pluginTypes }
  const ids = suppliedIds(parts)
  return { config: { ...TEST_PRODUCT_CONFIG, ...config, capabilities: ids.capabilities, modules: ids.modules, pluginTypes: [...new Set(ids.pluginTypes)] }, ...parts }
}

export interface TestDatabaseOptions {
  /** Started after the platform's own; their sets are applied and their activity event types registered. */
  definitions?: readonly CapabilityRegistryEntry[]
  seed?: boolean
}

export function openTestDatabase({ definitions = [], seed = true }: TestDatabaseOptions = {}): PlatformDatabase {
  const all = [...platformDefinitions(), ...definitions.filter(isCapabilityDefinition)]
  const database = openDatabase(':memory:', { sets: migrationSets(all) })
  registerActivityEventTypes(database.db, createActivityEventTypeRegistry(declaredActivityEventTypes(all)))
  if (seed) seedAuth(database.db)
  return database
}

export interface TempDataDir {
  root: string
  cleanup(): void
}

export function createTempDataDir(): TempDataDir {
  const parent = mkdtempSync(join(tmpdir(), 'platform-test-'))
  return { root: join(parent, 'data'), cleanup: () => rmSync(parent, { recursive: true, force: true }) }
}

export type TestPlatformOptions = Omit<PlatformOptions, 'product'> & ProductParts & {
  /** Built from the parts when not given. */
  product?: Product
}

export function startTestPlatform(dataDir: string, { product, capabilities, modules, pluginTypes, ...options }: TestPlatformOptions = {}): Platform {
  return startPlatform(dataDir, { product: product ?? testProduct({ capabilities, modules, pluginTypes }), ...options })
}

export type TestAppDeps = Omit<AppDeps, 'product'> & { product?: Product }

/** An app for route tests that pass their own registries or runtime. */
export function createTestApp({ product = testProduct(), ...deps }: TestAppDeps): ReturnType<typeof createApp> {
  return createApp({ product, ...deps })
}

/** The app a distribution's entry point would build over this platform. */
export function platformApp(platform: Platform, deps: Partial<AppDeps> = {}): ReturnType<typeof createApp> {
  return createApp({
    db: platform.db,
    paths: platform.paths,
    product: platform.product,
    capabilities: platform.capabilities,
    modules: platform.modules,
    pluginTypes: platform.pluginTypes,
    families: platform.families,
    workspaceFacts: platform.workspaceFacts,
    secrets: platform.secrets.writeOnly,
    secretsReader: platform.secrets,
    runtime: platform.runtime,
    ...deps,
  })
}

