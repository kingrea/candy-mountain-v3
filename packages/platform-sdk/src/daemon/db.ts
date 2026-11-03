import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

// Typed over no schema: queries name their table objects, so neither the platform's nor a capability's tables need a place in this type.
export type Db = BetterSQLite3Database<Record<string, unknown>>

export type MigrationSchema = Record<string, unknown>

/** Tracked under its own migrations table, so one set's history never renumbers another's. */
export interface MigrationSet {
  id: string
  schema: MigrationSchema
  migrationsFolder: string
}
