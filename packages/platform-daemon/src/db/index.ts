import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MANIFEST_ID_PATTERN } from '@candy-mountain/platform-sdk'
import type { Db, MigrationSet } from '@candy-mountain/platform-sdk/daemon'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { srcPath } from '../package-root'
import { carryLegacyHistory, type LegacyCarryOver } from './legacy-carry-over'
import * as schema from './schema'

export { schema }
export type { Db, MigrationSchema, MigrationSet } from '@candy-mountain/platform-sdk/daemon'
export { LEGACY_MIGRATIONS_DIR, type LegacyCarryOver } from './legacy-carry-over'

export class MigrationSetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationSetError'
  }
}

export interface AppliedMigrationSet {
  id: string
  table: string
  applied: number
}

export const MIGRATIONS_DIR = srcPath('db', 'migrations')

export const PLATFORM_MIGRATION_SET_ID = 'platform'

/** Applied first; a capability's tables are in its own set. */
export const PLATFORM_MIGRATION_SET: MigrationSet = Object.freeze({ id: PLATFORM_MIGRATION_SET_ID, schema, migrationsFolder: MIGRATIONS_DIR })

const MIGRATIONS_TABLE_PREFIX = '__drizzle_migrations_'

// Separators folded to `_` so the table name needs no quoting anywhere.
export const migrationsTableFor = (setId: string): string => `${MIGRATIONS_TABLE_PREFIX}${setId.replaceAll(/[-.]/g, '_')}`

export interface PlatformDatabase {
  db: Db
  migrationSets: readonly AppliedMigrationSet[]
  appliedMigrations: number
  /** Set on the one open that carried a database across from the numbered history. */
  legacyCarryOver: LegacyCarryOver | null
  close(): void
}

export interface OpenDatabaseOptions {
  sets?: readonly MigrationSet[]
}

export function assertMigrationSets(sets: readonly MigrationSet[]): void {
  const seen = new Map<string, string>()
  for (const set of sets) {
    if (typeof set.id !== 'string' || !MANIFEST_ID_PATTERN.test(set.id)) throw new MigrationSetError(`Invalid migration set id '${String(set.id)}'; ids are lowercase letters and digits joined by '-', '_' or '.'.`)
    if (typeof set.schema !== 'object' || set.schema === null) throw new MigrationSetError(`Migration set '${set.id}' has no schema object.`)
    if (typeof set.migrationsFolder !== 'string' || set.migrationsFolder === '') throw new MigrationSetError(`Migration set '${set.id}' names no migrations folder.`)
    const table = migrationsTableFor(set.id)
    const other = seen.get(table)
    if (other === set.id) throw new MigrationSetError(`Migration set '${set.id}' is listed more than once.`)
    if (other !== undefined) throw new MigrationSetError(`Migration sets '${other}' and '${set.id}' would share the migrations table '${table}'.`)
    seen.set(table, set.id)
    if (!existsSync(join(set.migrationsFolder, 'meta', '_journal.json'))) throw new MigrationSetError(`Migration set '${set.id}' has no migrations folder at ${set.migrationsFolder} (no meta/_journal.json).`)
  }
}

export function openDatabase(file: string, { sets = [PLATFORM_MIGRATION_SET] }: OpenDatabaseOptions = {}): PlatformDatabase {
  assertMigrationSets(sets)
  const sqlite = new Database(file)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = NORMAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    const db: Db = drizzle({ client: sqlite, schema: Object.assign({}, ...sets.map(set => set.schema)) as Record<string, unknown> })
    const legacyCarryOver = carryLegacyHistory(sqlite, sets)
    const migrationSets = sets.map((set) => {
      const table = migrationsTableFor(set.id)
      const before = countMigrations(sqlite, table)
      migrate(db, { migrationsFolder: set.migrationsFolder, migrationsTable: table })
      return { id: set.id, table, applied: countMigrations(sqlite, table) - before }
    })

    return {
      db,
      migrationSets,
      appliedMigrations: migrationSets.reduce((sum, set) => sum + set.applied, 0),
      legacyCarryOver,
      close: () => sqlite.close(),
    }
  }
  catch (error) {
    sqlite.close()
    throw error
  }
}

/** Drizzle's default table, where the numbered history before migration sets was recorded. */
export const LEGACY_MIGRATIONS_TABLE = '__drizzle_migrations'

/** A database from the numbered history that cannot be carried onto the per-set histories; nothing in it was changed. */
export class LegacyHistoryError extends MigrationSetError {
  constructor(reason: string) {
    super(`This database was created by the numbered migration history and cannot be carried across onto the per-set histories: ${reason}.`)
    this.name = 'LegacyHistoryError'
  }
}

function hasTable(sqlite: Database.Database, table: string): boolean {
  return sqlite.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', table) !== undefined
}

function countMigrations(sqlite: Database.Database, table: string): number {
  if (!hasTable(sqlite, table)) return 0
  const row = sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }
  return row.n
}
