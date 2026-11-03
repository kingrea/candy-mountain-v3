import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, describe, expect, it } from 'vitest'
import { migrationsTableFor, openDatabase, PLATFORM_MIGRATION_SET_ID } from '../db'
import { migrationsBefore } from '../db/test-support'
import { testMigrationSets } from '../testing'
import { findRepository } from './service'

describe('the repository migration', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('moves every project source and verification into the repository table and drops the columns', () => {
    dir = mkdtempSync(join(tmpdir(), 'candy-mountain-repository-migration-'))
    const file = join(dir, 'test.db')
    const table = migrationsTableFor(PLATFORM_MIGRATION_SET_ID)

    const before = new Database(file)
    migrate(drizzle({ client: before }), { migrationsFolder: migrationsBefore('0021_repositories', dir), migrationsTable: table })
    const columns = () => (before.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map(c => c.name)
    expect(columns()).toEqual(expect.arrayContaining(['source', 'verification']))
    const source = JSON.stringify({ kind: 'local-path', path: '/srv/alpha' })
    const verification = JSON.stringify({ checkedAt: '2026-11-03T10:00:00.000Z', pathExists: true, hasBeads: true, isGitRepo: true, hasRemote: false, remoteName: null, remoteUrl: null })
    before.prepare('INSERT INTO projects (id, slug, name, color, organisation_id, archived_at, source, verification, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)')
      .run('p1', 'alpha', 'Alpha', '#123456', source, verification, '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')
    before.prepare('INSERT INTO projects (id, slug, name, color, organisation_id, archived_at, source, verification, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)')
      .run('p2', 'beta', 'Beta', '#654321', JSON.stringify({ kind: 'local-path', path: '/srv/beta' }), verification, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')
    before.close()

    const database = openDatabase(file, { sets: testMigrationSets() })
    try {
      expect(database.legacyCarryOver).toEqual({ from: table, caughtUp: 2 })
      expect(findRepository(database.db, 'p1')).toEqual({
        workspaceId: 'p1',
        source: { kind: 'local-path', path: '/srv/alpha' },
        verification: JSON.parse(verification),
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-02T00:00:00.000Z',
      })
      expect(findRepository(database.db, 'p2')?.source.path).toBe('/srv/beta')
      const after = (new Database(file, { readonly: true }).prepare('PRAGMA table_info(workspaces)').all() as { name: string }[]).map(c => c.name)
      expect(after).not.toContain('source')
      expect(after).not.toContain('verification')
      expect(after).toContain('slug')
    }
    finally {
      database.close()
    }
  })
})
