import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateSQLiteDrizzleJson, generateSQLiteMigration, type DrizzleSQLiteSnapshotJSON } from 'drizzle-kit/api'
import { describe, expect, it } from 'vitest'
import { PLATFORM_MIGRATION_SET } from '.'
import { FIXTURE_MIGRATION_SETS } from './fixtures'

const sets = [PLATFORM_MIGRATION_SET, ...FIXTURE_MIGRATION_SETS]

describe('schema', () => {
  it.each(sets.map(set => [set.id, set] as const))('set %s has no changes missing a generated migration', async (id, set) => {
    const meta = join(set.migrationsFolder, 'meta')
    const snapshots = readdirSync(meta).filter(f => f.endsWith('_snapshot.json')).sort()
    const latest = JSON.parse(readFileSync(join(meta, snapshots.at(-1)!), 'utf8')) as DrizzleSQLiteSnapshotJSON
    const current = await generateSQLiteDrizzleJson(set.schema)

    expect(await generateSQLiteMigration(latest, current), `run \`pnpm --filter @candy-mountain/platform-daemon db:generate --config <the ${id} set's drizzle.config.ts> --name <short_name>\``).toEqual([])
  })
})
