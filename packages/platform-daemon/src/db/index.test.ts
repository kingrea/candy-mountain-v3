import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { assertMigrationSets, MigrationSetError, migrationsTableFor, openDatabase, PLATFORM_MIGRATION_SET, type MigrationSet, type PlatformDatabase } from '.'
import { ALPHA_MIGRATION_SET, alpha, BETA_MIGRATION_SET, beta, FIXTURE_MIGRATION_SETS } from './fixtures'

const tableNames = (db: PlatformDatabase['db']) => db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).map(r => r.name)

describe('migrationsTableFor', () => {
  it('names a table per set that needs no quoting', () => {
    expect(migrationsTableFor('platform')).toBe('__drizzle_migrations_platform')
    expect(migrationsTableFor('chat-claude-code')).toBe('__drizzle_migrations_chat_claude_code')
    expect(migrationsTableFor('a.b_c')).toBe('__drizzle_migrations_a_b_c')
  })
})

describe('assertMigrationSets', () => {
  const rejects = (sets: readonly MigrationSet[], message: string) => {
    expect(() => assertMigrationSets(sets)).toThrow(MigrationSetError)
    expect(() => assertMigrationSets(sets)).toThrow(message)
  }

  it('accepts the platform set and the fixture sets', () => {
    expect(() => assertMigrationSets([PLATFORM_MIGRATION_SET, ...FIXTURE_MIGRATION_SETS])).not.toThrow()
  })

  it('refuses a repeated set id, naming it', () => {
    rejects([ALPHA_MIGRATION_SET, BETA_MIGRATION_SET, ALPHA_MIGRATION_SET], "Migration set 'fixture-alpha' is listed more than once.")
  })

  it('refuses two ids that would share a migrations table, naming both', () => {
    rejects([ALPHA_MIGRATION_SET, { ...ALPHA_MIGRATION_SET, id: 'fixture_alpha' }], "Migration sets 'fixture-alpha' and 'fixture_alpha' would share the migrations table '__drizzle_migrations_fixture_alpha'.")
  })

  it('refuses a missing migrations folder, naming the set and the folder', () => {
    rejects([{ ...BETA_MIGRATION_SET, migrationsFolder: '/nowhere/beta' }], "Migration set 'fixture-beta' has no migrations folder at /nowhere/beta (no meta/_journal.json).")
    rejects([{ ...BETA_MIGRATION_SET, migrationsFolder: '' }], "Migration set 'fixture-beta' names no migrations folder.")
  })

  it('refuses a bad id or a missing schema', () => {
    rejects([{ ...ALPHA_MIGRATION_SET, id: 'Alpha Set' }], "Invalid migration set id 'Alpha Set'")
    rejects([{ ...ALPHA_MIGRATION_SET, schema: undefined as never }], "Migration set 'fixture-alpha' has no schema object.")
  })
})

describe('openDatabase with migration sets', () => {
  let dir: string
  const open: PlatformDatabase[] = []

  const file = () => join(dir, 'test.db')
  const openAt = (sets?: readonly MigrationSet[]) => {
    const database = openDatabase(file(), sets ? { sets } : {})
    open.push(database)
    return database
  }

  afterEach(() => {
    open.splice(0).forEach(d => d.close())
    rmSync(dir, { recursive: true, force: true })
  })

  it('applies each set in order under its own migrations table and reports per-set counts', () => {
    dir = mkdtempSync(join(tmpdir(), 'cm-db-'))
    const database = openAt(FIXTURE_MIGRATION_SETS)

    expect(database.migrationSets).toEqual([
      { id: 'fixture-alpha', table: '__drizzle_migrations_fixture_alpha', applied: 1 },
      { id: 'fixture-beta', table: '__drizzle_migrations_fixture_beta', applied: 1 },
    ])
    expect(database.appliedMigrations).toBe(2)
    expect(tableNames(database.db)).toEqual(['__drizzle_migrations_fixture_alpha', '__drizzle_migrations_fixture_beta', 'alpha_things', 'beta_items'])

    // The second set's foreign key points at the first set's table, which only works because the first applied first.
    database.db.insert(alpha.alphaThings).values({ id: 't1', name: 'thing' }).run()
    database.db.insert(beta.betaItems).values({ id: 'i1', thingId: 't1' }).run()
    expect(() => database.db.insert(beta.betaItems).values({ id: 'i2', thingId: 'missing' }).run()).toThrow(/FOREIGN KEY/)
    expect(database.db.select().from(beta.betaItems).all()).toEqual([{ id: 'i1', thingId: 't1' }])
  })

  it('applies nothing on a second open', () => {
    dir = mkdtempSync(join(tmpdir(), 'cm-db-'))
    openAt(FIXTURE_MIGRATION_SETS).close()

    const again = openAt(FIXTURE_MIGRATION_SETS)
    expect(again.migrationSets.map(s => s.applied)).toEqual([0, 0])
    expect(again.appliedMigrations).toBe(0)
  })

  it('defaults to the platform set alone', () => {
    dir = mkdtempSync(join(tmpdir(), 'cm-db-'))
    const database = openAt()
    expect(database.migrationSets.map(s => s.id)).toEqual(['platform'])
    expect(database.migrationSets[0]!.applied).toBeGreaterThan(0)
    expect(tableNames(database.db)).toContain('__drizzle_migrations_platform')
    expect(tableNames(database.db)).not.toContain('__drizzle_migrations')
  })

  it('refuses a duplicate set id or a missing folder before opening the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'cm-db-'))
    expect(() => openAt([ALPHA_MIGRATION_SET, ALPHA_MIGRATION_SET])).toThrow("Migration set 'fixture-alpha' is listed more than once.")
    expect(() => openAt([{ ...ALPHA_MIGRATION_SET, migrationsFolder: join(dir, 'missing') }])).toThrow(`Migration set 'fixture-alpha' has no migrations folder at ${join(dir, 'missing')}`)
    expect(existsSync(file())).toBe(false)
  })
})
