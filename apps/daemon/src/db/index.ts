import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { PACKAGE_ROOT } from '../package-root'
import * as schema from './schema'

export { schema }

export const MIGRATIONS_DIR = join(PACKAGE_ROOT, 'drizzle')
const MIGRATIONS_TABLE = '__drizzle_migrations'

export type Db = BetterSQLite3Database<typeof schema>

export interface PlatformDatabase {
  db: Db
  appliedMigrations: number
  close(): void
}

export interface OpenDatabaseOptions {
  migrationsFolder?: string
}

export function openDatabase(file: string, options: OpenDatabaseOptions = {}): PlatformDatabase {
  const sqlite = new Database(file)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = NORMAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    const db = drizzle({ client: sqlite, schema })
    const before = countMigrations(sqlite)
    migrate(db, { migrationsFolder: options.migrationsFolder ?? MIGRATIONS_DIR, migrationsTable: MIGRATIONS_TABLE })

    return {
      db,
      appliedMigrations: countMigrations(sqlite) - before,
      close: () => sqlite.close(),
    }
  }
  catch (error) {
    sqlite.close()
    throw error
  }
}

function countMigrations(sqlite: Database.Database): number {
  const exists = sqlite.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', MIGRATIONS_TABLE)
  if (!exists) return 0
  const row = sqlite.prepare(`SELECT count(*) AS n FROM "${MIGRATIONS_TABLE}"`).get() as { n: number }
  return row.n
}
