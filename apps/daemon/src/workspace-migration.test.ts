import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, describe, expect, it } from 'vitest'
import { migrationsBefore, migrationsTableFor, openDatabase, PLATFORM_MIGRATION_SET_ID, schemaShape } from '@candy-mountain/platform-daemon'
import { carriesPreSplitDatabases, testMigrationSets } from './testing'

const AT = '2026-11-01T00:00:00.000Z'

const count = (sqlite: Database.Database, table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n

// A legacy database carries across only onto the full product's sets.
describe.runIf(carriesPreSplitDatabases)('the workspace migration', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('renames the platform tables and columns to workspace and keeps every row', () => {
    dir = mkdtempSync(join(tmpdir(), 'candy-mountain-workspace-migration-'))
    const file = join(dir, 'old.db')
    const before = new Database(file)
    migrate(drizzle({ client: before }), { migrationsFolder: migrationsBefore('0022_workspaces', dir), migrationsTable: migrationsTableFor(PLATFORM_MIGRATION_SET_ID) })
    const run = (statement: string, ...values: unknown[]) => before.prepare(statement).run(...values)
    run('INSERT INTO organisations (id, slug, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'o1', 'acme', 'Acme', AT, AT)
    run('INSERT INTO projects (id, slug, name, color, organisation_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)', 'p1', 'alpha', 'Alpha', '#123456', 'o1', AT, AT)
    run('INSERT INTO projects (id, slug, name, color, organisation_id, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)', 'p2', 'beta', 'Beta', '#654321', AT, AT, AT)
    run('INSERT INTO project_modules (id, project_id, module_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'm1', 'p1', 'issues', AT, AT)
    run('INSERT INTO activity_events (id, project_id, type, title, occurred_at) VALUES (?, ?, ?, ?, ?)', 'a1', 'p1', 'issue.closed', 'Closed one', AT)
    run('INSERT INTO agent_sessions (id, project_id, family, actor_id, cwd, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 's1', 'p1', 'claude-code', 'u1', '/srv/alpha', AT, AT)
    run('INSERT INTO chat_threads (id, project_id, actor_id, agent_id, current_session_id, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 't1', 'p1', 'u1', 'claude-code', 's1', AT, AT, AT)
    run('INSERT INTO plugin_instances (id, type_id, scope, project_id, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'i1', 'codex', 'project', 'p1', '{"label":"own"}', AT, AT)
    run('INSERT INTO plugin_instances (id, type_id, scope, project_id, config, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)', 'i2', 'codex', 'global', '{}', AT, AT)
    run('INSERT INTO repositories (project_id, source, verification, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', 'p1', '{"kind":"local-path","path":"/srv/alpha"}', '{}', AT, AT)
    run('INSERT INTO bots (id, project_id, name, family, write_scope, answers_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'b1', 'p1', 'Pip', 'claude-code', 'read-only', '{"anywhere":true}', AT, AT)
    before.close()

    const database = openDatabase(file, { sets: testMigrationSets() })
    database.close()
    const after = new Database(file)
    try {
      after.pragma('foreign_keys = ON')
      const tables = (after.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(t => t.name)
      expect(tables).toEqual(expect.arrayContaining(['workspaces', 'workspace_modules']))
      expect(tables).not.toContain('projects')
      expect(tables).not.toContain('project_modules')

      expect(after.prepare('SELECT id, slug, name, color, organisation_id, archived_at FROM workspaces ORDER BY id').all()).toEqual([
        { id: 'p1', slug: 'alpha', name: 'Alpha', color: '#123456', organisation_id: 'o1', archived_at: null },
        { id: 'p2', slug: 'beta', name: 'Beta', color: '#654321', organisation_id: null, archived_at: AT },
      ])
      expect(after.prepare('SELECT workspace_id, module_id FROM workspace_modules').all()).toEqual([{ workspace_id: 'p1', module_id: 'issues' }])
      expect(after.prepare('SELECT workspace_id, title FROM activity_events').all()).toEqual([{ workspace_id: 'p1', title: 'Closed one' }])
      expect(after.prepare('SELECT workspace_id, cwd FROM agent_sessions').all()).toEqual([{ workspace_id: 'p1', cwd: '/srv/alpha' }])
      expect(after.prepare('SELECT workspace_id, current_session_id FROM chat_threads').all()).toEqual([{ workspace_id: 'p1', current_session_id: 's1' }])
      expect(after.prepare('SELECT id, scope, workspace_id, config FROM plugin_instances ORDER BY id').all()).toEqual([
        { id: 'i1', scope: 'workspace', workspace_id: 'p1', config: '{"label":"own"}' },
        { id: 'i2', scope: 'global', workspace_id: null, config: '{}' },
      ])
      expect(after.prepare('SELECT workspace_id FROM repositories').all()).toEqual([{ workspace_id: 'p1' }])
      expect(after.prepare('SELECT project_id FROM bots').all()).toEqual([{ project_id: 'p1' }])
      expect(after.pragma('foreign_key_check')).toEqual([])

      after.prepare('DELETE FROM workspaces WHERE id = ?').run('p1')
      for (const table of ['workspace_modules', 'activity_events', 'agent_sessions', 'chat_threads', 'repositories', 'bots']) expect(count(after, table), table).toBe(0)
      expect(count(after, 'plugin_instances')).toBe(1)
    }
    finally {
      after.close()
    }
  })

  it('leaves a migrated database shaped like one built straight from the schema', async () => {
    dir = mkdtempSync(join(tmpdir(), 'candy-mountain-workspace-migration-'))
    const old = new Database(join(dir, 'old.db'))
    migrate(drizzle({ client: old }), { migrationsFolder: migrationsBefore('0022_workspaces', dir), migrationsTable: migrationsTableFor(PLATFORM_MIGRATION_SET_ID) })
    old.close()
    openDatabase(join(dir, 'old.db'), { sets: testMigrationSets() }).close()

    const built = new Database(join(dir, 'built.db'))
    for (const statement of await generateSQLiteMigration(await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(Object.assign({}, ...testMigrationSets().map(set => set.schema))))) built.exec(statement)
    const migrated = new Database(join(dir, 'old.db'), { readonly: true })
    try {
      expect(schemaShape(migrated)).toEqual(schemaShape(built))
    }
    finally {
      migrated.close()
      built.close()
    }
  })
})
