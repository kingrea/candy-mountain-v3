import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { CANDY_MOUNTAIN } from './candy-mountain'
import type { CapabilityDefinition } from './capabilities/definition'
import { fixtureDefinition } from './capabilities/fixtures'
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core'
import { MIGRATIONS_DIR, MigrationSetError, migrationsTableFor, schema } from './db'
import { ALPHA_MIGRATION_SET, alpha, beta, BETA_MIGRATION_SET } from './db/fixtures'
import { startPlatform, type Platform } from './platform'
import { createTempDataDir, testMigrationSets, type TempDataDir } from './testing'
import { startTestPlatform, withoutCapabilities } from './testing/platform'

describe('startPlatform', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  function start(migrationsFolder?: string) {
    const platform = startPlatform(temp.root, { product: CANDY_MOUNTAIN, migrationsFolder })
    open.push(platform)
    return platform
  }

  afterEach(() => {
    open.splice(0).forEach(p => p.close())
    temp?.cleanup()
  })

  it('creates the data directory tree and migrates an empty directory', () => {
    temp = createTempDataDir()
    const platform = start()

    for (const dir of [platform.paths.root, platform.paths.secrets, platform.paths.worktrees, platform.paths.agentHomes, platform.paths.logs, platform.paths.run]) {
      expect(statSync(dir).isDirectory()).toBe(true)
    }
    expect(statSync(platform.paths.root).mode & 0o777).toBe(0o700)
    expect(existsSync(platform.paths.database)).toBe(true)
    const sets = testMigrationSets()
    expect(sets.map(set => set.id).sort()).toEqual(['bots', 'deployments', 'issues', 'platform', 'repository', 'team', 'uptime'])
    expect(platform.migrationSets).toEqual(sets.map(set => ({ id: set.id, table: migrationsTableFor(set.id), applied: journalLength(set.migrationsFolder) })))
    expect(platform.appliedMigrations).toBe(sets.reduce((sum, set) => sum + journalLength(set.migrationsFolder), 0))
    expect(platform.db.select().from(schema.platformMeta).all()).toEqual([])
  })

  it('is a no-op on a second start', () => {
    temp = createTempDataDir()
    const first = start()
    first.db.insert(schema.platformMeta).values({ key: 'k', value: 'v', updatedAt: '2026-01-01T00:00:00Z' }).run()
    first.close()

    const second = start()
    expect(second.appliedMigrations).toBe(0)
    expect(second.migrationSets).toEqual(testMigrationSets().map(set => ({ id: set.id, table: migrationsTableFor(set.id), applied: 0 })))
    expect(second.db.select().from(schema.platformMeta).where(eq(schema.platformMeta.key, 'k')).get()?.value).toBe('v')
  })

  it('applies a newly added migration on the next start', () => {
    temp = createTempDataDir()
    const migrations = join(temp.root, '..', 'migrations')
    cpSync(MIGRATIONS_DIR, migrations, { recursive: true })
    start(migrations).close()

    addMigration(migrations, '9999_probe', 'CREATE TABLE `probe` (`id` integer PRIMARY KEY NOT NULL);')
    const next = start(migrations)

    expect(next.appliedMigrations).toBe(1)
    expect(next.db.get(sql`SELECT name FROM sqlite_master WHERE name = 'probe'`)).toEqual({ name: 'probe' })
  })
})

describe('startPlatform with a subset of the product', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(() => {
    open.splice(0).forEach(p => p.close())
    temp?.cleanup()
  })

  const tables = (platform: Platform) => platform.db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB '__drizzle*' AND name NOT GLOB 'sqlite_*'`).map(row => row.name).sort()
  const platformTables = Object.values(schema).map(table => getTableConfig(table as SQLiteTable).name).sort()

  it('leaves no uptime table when the product has no uptime', () => {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, withoutCapabilities('uptime'))
    open.push(platform)

    expect(platform.migrationSets.map(set => set.id)).not.toContain('uptime')
    expect(tables(platform).filter(name => name.startsWith('uptime'))).toEqual([])
    expect(tables(platform)).toContain('bots')
  })

  it('leaves only the platform tables when the product has no capability', () => {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, { capabilities: [], modules: [] })
    open.push(platform)

    expect(platform.migrationSets.map(set => set.id)).toEqual(['platform'])
    expect(tables(platform)).toEqual(platformTables)
  })
})

describe('startPlatform with capability schema sets', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(() => {
    open.splice(0).forEach(p => p.close())
    temp?.cleanup()
  })

  const declared = (id: string, set: { schema: Record<string, unknown>, migrationsFolder: string }, dependsOn?: readonly string[]) => fixtureDefinition(id, { manifest: null, schema: { schema: set.schema, migrationsFolder: set.migrationsFolder }, dependsOn })

  function start(capabilities: readonly CapabilityDefinition[]) {
    const platform = startTestPlatform(temp.root, { capabilities, modules: [] })
    open.push(platform)
    return platform
  }

  it('applies the platform set first, then each declared set in dependency order, and names each with its count', () => {
    temp = createTempDataDir()
    // Listed dependent first: the dependency order, not the list order, decides.
    const platform = start([declared('fixture-beta', BETA_MIGRATION_SET, ['fixture-alpha']), declared('fixture-alpha', ALPHA_MIGRATION_SET)])

    expect(platform.migrationSets).toEqual([
      { id: 'platform', table: '__drizzle_migrations_platform', applied: journalLength(MIGRATIONS_DIR) },
      { id: 'fixture-alpha', table: '__drizzle_migrations_fixture_alpha', applied: 1 },
      { id: 'fixture-beta', table: '__drizzle_migrations_fixture_beta', applied: 1 },
    ])
    platform.db.insert(alpha.alphaThings).values({ id: 't', name: 'thing' }).run()
    platform.db.insert(beta.betaItems).values({ id: 'i', thingId: 't' }).run()
    expect(platform.db.select().from(beta.betaItems).all()).toEqual([{ id: 'i', thingId: 't' }])
    platform.close()

    const again = start([declared('fixture-alpha', ALPHA_MIGRATION_SET), declared('fixture-beta', BETA_MIGRATION_SET, ['fixture-alpha'])])
    expect(again.migrationSets.map(set => set.applied)).toEqual([0, 0, 0])
  })

  it('refuses boot on a set id the platform already uses or a missing folder, naming it, and touches nothing on disk', () => {
    temp = createTempDataDir()
    const boot = (capabilities: readonly CapabilityDefinition[]) => () => start(capabilities)

    expect(boot([declared('platform', ALPHA_MIGRATION_SET)])).toThrow(MigrationSetError)
    expect(boot([declared('platform', ALPHA_MIGRATION_SET)])).toThrow("Migration set 'platform' is listed more than once.")
    expect(boot([declared('fixture-alpha', { ...ALPHA_MIGRATION_SET, migrationsFolder: '/nowhere/alpha' })])).toThrow("Migration set 'fixture-alpha' has no migrations folder at /nowhere/alpha (no meta/_journal.json).")
    expect(existsSync(temp.root)).toBe(false)
  })
})

interface Journal {
  entries: { idx: number, version: string, when: number, tag: string, breakpoints: boolean }[]
}

function readJournal(folder: string): Journal {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as Journal
}

function journalLength(folder: string): number {
  return readJournal(folder).entries.length
}

function addMigration(folder: string, tag: string, statement: string) {
  const journal = readJournal(folder)
  const last = journal.entries.at(-1)
  journal.entries.push({ idx: journal.entries.length, version: last?.version ?? '6', when: (last?.when ?? 0) + 1, tag, breakpoints: true })
  writeFileSync(join(folder, `${tag}.sql`), statement)
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
}
