// Deletable once Jack's database has crossed (daemon README, Database): no other database was made by the numbered history.
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { srcPath } from '../package-root'
import { LEGACY_MIGRATIONS_TABLE, LegacyHistoryError, migrationsTableFor, PLATFORM_MIGRATION_SET_ID, type MigrationSet } from '.'

export const LEGACY_MIGRATIONS_DIR = srcPath('db', 'fixtures', 'legacy')

export interface LegacyCarryOver {
  from: string
  caughtUp: number
}

interface LegacyMigration extends MigrationMeta {
  tag: string
}

let legacy: readonly LegacyMigration[] | undefined

function legacyMigrations(): readonly LegacyMigration[] {
  if (legacy) return legacy
  const { entries } = JSON.parse(readFileSync(join(LEGACY_MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  legacy = readMigrationFiles({ migrationsFolder: LEGACY_MIGRATIONS_DIR }).map((migration, index) => ({ ...migration, tag: entries[index]!.tag }))
  return legacy
}

const MIGRATIONS_TABLE_CREATE = (table: string) => `CREATE TABLE IF NOT EXISTS "${table}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`

/** One transaction, so a failure leaves the database on the numbered history to be carried again next open. */
export function carryLegacyHistory(sqlite: Database.Database, sets: readonly MigrationSet[]): LegacyCarryOver | null {
  const from = legacyHistoryTable(sqlite)
  if (from === undefined) return null
  const others = migrationsTables(sqlite).filter(table => table !== from)
  if (others.length > 0) throw new LegacyHistoryError(`it has the numbered history in '${from}' and per-set histories in ${others.map(t => `'${t}'`).join(', ')}, so it is part-way between the two and cannot be carried across`)

  const recorded = sqlite.prepare(`SELECT hash, created_at FROM "${from}" ORDER BY created_at, rowid`).all() as { hash: string, created_at: number | string | null }[]
  const migrations = legacyMigrations()
  if (recorded.length > migrations.length) throw new LegacyHistoryError(`'${from}' records ${recorded.length} migrations; the numbered history has only ${migrations.length}, so it has entries the history does not know`)
  recorded.forEach((row, index) => {
    const expected = migrations[index]!
    if (row.hash !== expected.hash) throw new LegacyHistoryError(`entry ${index + 1} of '${from}' has hash ${row.hash}, which is not ${expected.tag}'s (${expected.hash}); it was edited or comes from another history`)
    if (Number(row.created_at) !== expected.folderMillis) throw new LegacyHistoryError(`entry ${index + 1} of '${from}' (${expected.tag}) was recorded at ${String(row.created_at)}, not at ${expected.folderMillis}`)
  })
  const legacyTables = assertSetsOwnLegacyTables(sets)

  const pending = migrations.slice(recorded.length)
  // A table rebuild under a transaction cascades into child rows with foreign keys on, so they are off and foreign_key_check enforces them instead.
  sqlite.pragma('foreign_keys = OFF')
  try {
    sqlite.transaction(() => {
      const record = (table: string, migration: MigrationMeta) => sqlite.prepare(`INSERT INTO "${table}" ("hash", "created_at") VALUES (?, ?)`).run(migration.hash, migration.folderMillis)
      for (const migration of pending) {
        for (const statement of migration.sql) sqlite.exec(statement)
        record(from, migration)
      }
      const violations = legacyTables.filter(table => (sqlite.pragma(`foreign_key_check("${table}")`) as unknown[]).length > 0)
      if (violations.length > 0) throw new LegacyHistoryError(`rows in ${violations.map(t => `'${t}'`).join(', ')} point at rows that do not exist`)

      sqlite.exec(`DROP TABLE "${from}"`)
      for (const set of sets) {
        const table = migrationsTableFor(set.id)
        sqlite.exec(MIGRATIONS_TABLE_CREATE(table))
        for (const migration of readMigrationFiles({ migrationsFolder: set.migrationsFolder })) record(table, migration)
      }
    }).immediate()
  }
  finally {
    sqlite.pragma('foreign_keys = ON')
  }
  return { from, caughtUp: pending.length }
}

// The first migration-sets build ran the numbered folder as the platform set, leaving legacy hashes in the platform table.
function legacyHistoryTable(sqlite: Database.Database): string | undefined {
  if (hasTable(sqlite, LEGACY_MIGRATIONS_TABLE)) return LEGACY_MIGRATIONS_TABLE
  const platform = migrationsTableFor(PLATFORM_MIGRATION_SET_ID)
  if (!hasTable(sqlite, platform)) return undefined
  const hashes = new Set(legacyMigrations().map(migration => migration.hash))
  const rows = sqlite.prepare(`SELECT hash FROM "${platform}"`).all() as { hash: string }[]
  return rows.some(row => hashes.has(row.hash)) ? platform : undefined
}

// Compared in memory, not against the file, because Mastra keeps its own tables in it.
function assertSetsOwnLegacyTables(sets: readonly MigrationSet[]): string[] {
  const tablesBuiltBy = (apply: (sqlite: Database.Database) => void) => {
    const sqlite = new Database(':memory:')
    try {
      apply(sqlite)
      return dataTables(sqlite)
    }
    finally {
      sqlite.close()
    }
  }
  const legacyTables = tablesBuiltBy(sqlite => migrate(drizzle({ client: sqlite }), { migrationsFolder: LEGACY_MIGRATIONS_DIR }))
  const setTables = tablesBuiltBy((sqlite) => {
    for (const set of sets) migrate(drizzle({ client: sqlite }), { migrationsFolder: set.migrationsFolder, migrationsTable: migrationsTableFor(set.id) })
  })
  const unowned = legacyTables.filter(table => !setTables.includes(table))
  const unknown = setTables.filter(table => !legacyTables.includes(table))
  if (unowned.length > 0 || unknown.length > 0) {
    const problems = [
      unowned.length > 0 ? `no set being opened owns ${unowned.map(t => `'${t}'`).join(', ')}` : '',
      unknown.length > 0 ? `the sets being opened make ${unknown.map(t => `'${t}'`).join(', ')}, which the numbered history never made` : '',
    ].filter(Boolean)
    throw new LegacyHistoryError(`${problems.join(' and ')}; it can only be carried across by the sets of the full product that made it`)
  }
  return legacyTables
}

function dataTables(sqlite: Database.Database): string[] {
  const rows = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_drizzle%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]
  return rows.map(row => row.name)
}

function migrationsTables(sqlite: Database.Database): string[] {
  const rows = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_\\_drizzle\\_migrations%' ESCAPE '\\' ORDER BY name`).all() as { name: string }[]
  return rows.map(row => row.name)
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return sqlite.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', table) !== undefined
}
