import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { LEGACY_MIGRATIONS_DIR } from './fixtures'

interface Journal {
  entries: { idx: number, tag: string }[]
}

/** The legacy numbered history cut off before `tag`, so a database can be built on the schema that came before it. */
export function migrationsBefore(tag: string, into: string): string {
  const folder = join(into, 'migrations')
  mkdirSync(join(folder, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(LEGACY_MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as Journal & Record<string, unknown>
  const cut = journal.entries.findIndex(entry => entry.tag === tag)
  if (cut <= 0) throw new Error(`No migration '${tag}' after the first in the legacy journal`)
  const entries = journal.entries.slice(0, cut)
  for (const entry of entries) cpSync(join(LEGACY_MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  return folder
}

const byKey = (a: string, b: string) => a.localeCompare(b)

/**
 * Every table's columns, foreign keys and indexes, order-insensitive, so two databases compare equal however their DDL was written or applied.
 * Migrations tables are left out: which history built a database is not its shape.
 */
export function schemaShape(sqlite: Database.Database): Record<string, unknown> {
  const all = <T>(statement: string) => sqlite.prepare(statement).all() as T[]
  const tables = all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_drizzle%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'`).map(t => t.name).sort(byKey)
  return Object.fromEntries(tables.map(table => [table, {
    columns: all<{ name: string, type: string, notnull: number, dflt_value: string | null, pk: number }>(`PRAGMA table_info("${table}")`)
      .map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, default: dflt_value, pk }))
      .sort((a, b) => byKey(a.name, b.name)),
    foreignKeys: all<{ table: string, from: string, to: string, on_update: string, on_delete: string }>(`PRAGMA foreign_key_list("${table}")`)
      .map(({ table: target, from, to, on_update, on_delete }) => ({ target, from, to, onUpdate: on_update, onDelete: on_delete }))
      .sort((a, b) => byKey(`${a.target}.${a.from}`, `${b.target}.${b.from}`)),
    indexes: all<{ name: string, unique: number, origin: string, partial: number }>(`PRAGMA index_list("${table}")`)
      .filter(index => !index.name.startsWith('sqlite_autoindex'))
      .map(index => ({
        name: index.name,
        unique: index.unique,
        partial: index.partial,
        columns: all<{ name: string }>(`PRAGMA index_info("${index.name}")`).map(c => c.name),
        where: normaliseOrNull((sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?`).get(index.name) as { sql: string | null }).sql?.match(/\bWHERE\b(.*)$/is)?.[1]),
      }))
      .sort((a, b) => byKey(a.name, b.name)),
    checks: [...tableSql(sqlite, table).matchAll(/CONSTRAINT\s+\S+\s+CHECK\s*\((.*?)\)\s*(?:,|\)$)/gis)].map(m => normalise(m[1]!)).sort(byKey),
  }]))
}

const normalise = (text: string) => text.replaceAll(/["`]/g, '').replaceAll(/\s+/g, ' ').trim()
const normaliseOrNull = (text: string | undefined) => (text === undefined ? null : normalise(text))

const tableSql = (sqlite: Database.Database, table: string) => (sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) as { sql: string }).sql
