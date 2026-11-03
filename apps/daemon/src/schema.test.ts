import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCapabilityDefinition, migrationSets, platformDefinitions } from '@candy-mountain/platform-daemon'
import { generateSQLiteDrizzleJson, generateSQLiteMigration, type DrizzleSQLiteSnapshotJSON } from 'drizzle-kit/api'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN } from './candy-mountain'

const definitions = [...platformDefinitions(), ...CANDY_MOUNTAIN.capabilities.filter(isCapabilityDefinition)]
/** Every set the product boots, each checked against its own folder's latest snapshot. */
const sets = migrationSets(definitions)

const tablesOf = (schema: Record<string, unknown>) => Object.values(schema).filter((value): value is SQLiteTable => value instanceof SQLiteTable)

describe('schema', () => {
  it.each(sets.map(set => [set.id, set] as const))('set %s has no changes missing a generated migration', async (id, set) => {
    const meta = join(set.migrationsFolder, 'meta')
    const snapshots = readdirSync(meta).filter(f => f.endsWith('_snapshot.json')).sort()
    const latest = JSON.parse(readFileSync(join(meta, snapshots.at(-1)!), 'utf8')) as DrizzleSQLiteSnapshotJSON
    const current = await generateSQLiteDrizzleJson(set.schema)

    expect(await generateSQLiteMigration(latest, current), `run \`pnpm --filter @candy-mountain/daemon db:generate --config <the ${id} set's drizzle.config.ts> --name <short_name>\``).toEqual([])
  })

  it.each(sets.filter(set => set.id !== 'platform').map(set => [set.id, set] as const))('set %s references only platform tables, its own and its declared dependencies\'', (id, set) => {
    const dependsOn = definitions.find(definition => definition.id === id)?.dependsOn ?? []
    const allowed = new Set(sets.filter(other => other.id === 'platform' || other.id === id || dependsOn.includes(other.id)).flatMap(other => tablesOf(other.schema).map(table => getTableConfig(table).name)))
    const referenced = tablesOf(set.schema).flatMap(table => getTableConfig(table).foreignKeys.map(fk => getTableConfig(fk.reference().foreignTable).name))
    expect(referenced.filter(name => !allowed.has(name))).toEqual([])
  })
})
