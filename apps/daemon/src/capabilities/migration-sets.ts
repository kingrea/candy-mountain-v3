import { PLATFORM_MIGRATION_SET, type MigrationSet } from '../db'
import type { CapabilityDefinition } from './definition'
import { orderCapabilityDefinitions } from './registry'

/** The platform's set first, then each declared set in dependency order; `assertMigrationSets` refuses a repeated id or a missing folder. */
export function migrationSets(definitions: readonly CapabilityDefinition[], platform: MigrationSet = PLATFORM_MIGRATION_SET): MigrationSet[] {
  return [platform, ...orderCapabilityDefinitions(definitions).flatMap(d => (d.schema ? [{ id: d.id, ...d.schema }] : []))]
}
