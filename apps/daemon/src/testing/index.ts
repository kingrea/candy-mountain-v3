import { isCapabilityDefinition, migrationSets, platformDefinitions, type MigrationSet } from '@crab-shack/platform-daemon'
import { CANDY_MOUNTAIN } from '../candy-mountain'

export { createTempDataDir, type TempDataDir } from '@crab-shack/platform-daemon/testing'
export * from './platform'

/** Every set Candy Mountain boots, in the order it applies them. */
export const testMigrationSets = (): MigrationSet[] => migrationSets([...platformDefinitions(), ...CANDY_MOUNTAIN.capabilities.filter(isCapabilityDefinition)])
