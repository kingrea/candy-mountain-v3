import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateSQLiteDrizzleJson, generateSQLiteMigration, type DrizzleSQLiteSnapshotJSON } from 'drizzle-kit/api'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, schema } from '.'

describe('schema', () => {
  it('has no changes missing a generated migration', async () => {
    const snapshots = readdirSync(join(MIGRATIONS_DIR, 'meta')).filter(f => f.endsWith('_snapshot.json')).sort()
    const latest = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', snapshots.at(-1)!), 'utf8')) as DrizzleSQLiteSnapshotJSON
    const current = await generateSQLiteDrizzleJson(schema)

    expect(await generateSQLiteMigration(latest, current), 'run `pnpm --filter @candy-mountain/daemon db:generate`').toEqual([])
  })
})
