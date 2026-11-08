import { createActivityEventTypeRegistry, declaredActivityEventTypes, instanceHarness as platformInstanceHarness, isCapabilityDefinition, migrationSets, openTestDatabase as openPlatformTestDatabase, platformDefinitions, type AnyPluginType, type InstanceHarness, type InstanceHarnessOptions, type MigrationSet, type PlatformDatabase } from '@candy-mountain/platform-daemon'
import { CANDY_MOUNTAIN } from '../candy-mountain'
import { createWorkspaceWithRepository } from '@candy-mountain/plugin-repository'

export { createTempDataDir, type TempDataDir } from '@candy-mountain/platform-daemon'
export * from './platform'

const candyMountainDefinitions = () => [...platformDefinitions(), ...CANDY_MOUNTAIN.capabilities.filter(isCapabilityDefinition)]

/** Candy Mountain's types as its platform registers them, so services emitting into a bare test database are not refused. */
export const testActivityEventTypes = () => createActivityEventTypeRegistry(declaredActivityEventTypes(candyMountainDefinitions()))

/** Every set Candy Mountain boots, in the order it applies them. */
export const testMigrationSets = (): MigrationSet[] => migrationSets(candyMountainDefinitions())

/** Every Candy Mountain table, with its activity event types registered. */
export function openTestDatabase({ seed = true }: { seed?: boolean } = {}): PlatformDatabase {
  return openPlatformTestDatabase({ definitions: CANDY_MOUNTAIN.capabilities, seed })
}

/** The platform's harness serving Candy Mountain over its tables, its workspaces carrying a repository so capabilities that run in a checkout can be exercised. */
export function instanceHarness(types: readonly AnyPluginType[], options: Omit<InstanceHarnessOptions, 'createWorkspace' | 'openDatabase' | 'product'> = {}): InstanceHarness {
  return platformInstanceHarness(types, { ...options, product: CANDY_MOUNTAIN, openDatabase: openTestDatabase, createWorkspace: createWorkspaceWithRepository })
}
