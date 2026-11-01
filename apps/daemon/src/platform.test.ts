import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { CANDY_MOUNTAIN } from './candy-mountain'
import { MIGRATIONS_DIR, schema } from './db'
import { startPlatform, type Platform } from './platform'
import { createTempDataDir, type TempDataDir } from './testing'

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
    expect(platform.appliedMigrations).toBe(journalLength(MIGRATIONS_DIR))
    expect(platform.db.select().from(schema.platformMeta).all()).toEqual([])
  })

  it('is a no-op on a second start', () => {
    temp = createTempDataDir()
    const first = start()
    first.db.insert(schema.platformMeta).values({ key: 'k', value: 'v', updatedAt: '2026-01-01T00:00:00Z' }).run()
    first.close()

    const second = start()
    expect(second.appliedMigrations).toBe(0)
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
