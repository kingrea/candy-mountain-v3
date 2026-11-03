import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createActivityEventTypeRegistry, declaredActivityEventTypes, registerActivityEventTypes } from '../activity/types'
import { seedAuth } from '../auth/seed'
import { CANDY_MOUNTAIN } from '../candy-mountain'
import { isCapabilityDefinition } from '../capabilities/definition'
import { migrationSets } from '../capabilities/migration-sets'
import { openDatabase, type MigrationSet, type PlatformDatabase } from '../db'
import { platformDefinitions } from '../platform-capabilities'

const candyMountainDefinitions = () => [...platformDefinitions(), ...CANDY_MOUNTAIN.capabilities.filter(isCapabilityDefinition)]

/** Candy Mountain's types as its platform registers them, so services emitting into a bare test database are not refused. */
export const testActivityEventTypes = () => createActivityEventTypeRegistry(declaredActivityEventTypes(candyMountainDefinitions()))

/** Every set Candy Mountain boots, in the order it applies them. */
export const testMigrationSets = (): MigrationSet[] => migrationSets(candyMountainDefinitions())

export function openTestDatabase({ seed = true }: { seed?: boolean } = {}): PlatformDatabase {
  const database = openDatabase(':memory:', { sets: testMigrationSets() })
  registerActivityEventTypes(database.db, testActivityEventTypes())
  if (seed) seedAuth(database.db)
  return database
}

export interface TempDataDir {
  root: string
  cleanup(): void
}

export function createTempDataDir(): TempDataDir {
  const parent = mkdtempSync(join(tmpdir(), 'candy-mountain-test-'))
  return { root: join(parent, 'data'), cleanup: () => rmSync(parent, { recursive: true, force: true }) }
}
