import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carriesPreSplitDatabases, testMigrationSets } from './testing'
import { LEGACY_MIGRATIONS_DIR, LEGACY_MIGRATIONS_TABLE, LegacyHistoryError, migrationsBefore, migrationsTableFor, openDatabase, PLATFORM_MIGRATION_SET_ID, schemaShape } from '@candy-mountain/platform-daemon'

const AT = '2026-11-01T00:00:00.000Z'
const LEGACY_LENGTH = (JSON.parse(readFileSync(join(LEGACY_MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }).entries.length

const tableNames = (sqlite: Database.Database) => (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map(t => t.name)
const dataTables = (sqlite: Database.Database) => tableNames(sqlite).filter(name => !name.startsWith('__drizzle') && !name.startsWith('sqlite_'))
const rowsOf = (sqlite: Database.Database) => Object.fromEntries(dataTables(sqlite).map(table => [table, sqlite.prepare(`SELECT * FROM "${table}" ORDER BY 1, 2`).all()]))
const insert = (sqlite: Database.Database) => (table: string, row: Record<string, unknown>) => {
  const columns = Object.keys(row)
  sqlite.prepare(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(row))
}

describe('the per-set histories against the legacy numbered history', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cm-legacy-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  /** As a daemon from before migration sets built it: the numbered folder, whole or cut before `before`, under Drizzle's default table or the one named. */
  function legacyDatabase(name: string, { before, table }: { before?: string, table?: string } = {}) {
    const file = join(dir, `${name}.db`)
    const folder = before === undefined ? LEGACY_MIGRATIONS_DIR : migrationsBefore(before, join(dir, name))
    const sqlite = new Database(file)
    migrate(drizzle({ client: sqlite }), { migrationsFolder: folder, ...(table === undefined ? {} : { migrationsTable: table }) })
    return { file, sqlite }
  }

  function freshShape() {
    const file = join(dir, 'fresh.db')
    openDatabase(file, { sets: testMigrationSets() }).close()
    const sqlite = new Database(file, { readonly: true })
    try {
      return schemaShape(sqlite)
    }
    finally {
      sqlite.close()
    }
  }

  function readBack<T>(file: string, read: (sqlite: Database.Database) => T): T {
    const sqlite = new Database(file, { readonly: true })
    try {
      return read(sqlite)
    }
    finally {
      sqlite.close()
    }
  }

  function expectPerSetHistories(sqlite: Database.Database) {
    const tables = tableNames(sqlite)
    expect(tables).not.toContain(LEGACY_MIGRATIONS_TABLE)
    for (const set of testMigrationSets()) {
      const recorded = sqlite.prepare(`SELECT hash, created_at FROM "${migrationsTableFor(set.id)}" ORDER BY created_at`).all()
      expect(recorded, set.id).toEqual(readMigrationFiles({ migrationsFolder: set.migrationsFolder }).map(m => ({ hash: m.hash, created_at: m.folderMillis })))
    }
    expect(tables.filter(name => name.startsWith('__drizzle'))).toHaveLength(testMigrationSets().length)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  }

  it.runIf(carriesPreSplitDatabases)('build the same tables, columns, foreign keys and indexes', () => {
    const { sqlite } = legacyDatabase('legacy')
    try {
      const expected = schemaShape(sqlite)
      expect(Object.keys(expected).length).toBeGreaterThan(20)
      expect(freshShape()).toEqual(expected)
    }
    finally {
      sqlite.close()
    }
  })

  it.runIf(carriesPreSplitDatabases)('carry a fully migrated database across with every row, applying nothing', () => {
    const { file, sqlite } = legacyDatabase('full')
    const row = insert(sqlite)
    row('organisations', { id: 'o1', slug: 'acme', name: 'Acme', created_at: AT, updated_at: AT })
    row('workspaces', { id: 'w1', slug: 'alpha', name: 'Alpha', color: '#123456', organisation_id: 'o1', created_at: AT, updated_at: AT })
    row('workspace_modules', { id: 'm1', workspace_id: 'w1', module_id: 'issues', created_at: AT, updated_at: AT })
    row('users', { id: 'u1', username: 'jack', display_name: 'Jack', created_at: AT, updated_at: AT })
    row('user_passwords', { user_id: 'u1', password_hash: 'x', created_at: AT, updated_at: AT })
    row('roles', { id: 'r1', slug: 'admin', name: 'Admin', created_at: AT, updated_at: AT })
    row('user_roles', { user_id: 'u1', role_id: 'r1', created_at: AT })
    row('role_grants', { id: 'g1', role_id: 'r1', target_kind: 'module', target_id: 'issues', rungs: '["view"]', created_at: AT, updated_at: AT })
    row('auth_sessions', { id: 'as1', user_id: 'u1', created_at: AT, expires_at: AT, last_seen_at: AT })
    row('platform_meta', { key: 'k', value: 'v', updated_at: AT })
    row('plugin_instances', { id: 'i1', type_id: 'codex', scope: 'workspace', workspace_id: 'w1', config: '{}', created_at: AT, updated_at: AT })
    row('activity_events', { id: 'a1', workspace_id: 'w1', type: 'issue.closed', title: 'Closed', occurred_at: AT })
    row('agent_sessions', { id: 's1', workspace_id: 'w1', family: 'claude-code', actor_id: 'u1', cwd: '/srv/alpha', created_at: AT, last_activity_at: AT })
    row('agent_session_events', { session_id: 's1', seq: 1, kind: 'prompt', payload: '{}', created_at: AT })
    row('chat_threads', { id: 't1', workspace_id: 'w1', actor_id: 'u1', agent_id: 'claude-code', current_session_id: 's1', last_activity_at: AT, created_at: AT, updated_at: AT })
    row('chat_thread_sessions', { thread_id: 't1', session_id: 's1', created_at: AT })
    row('repositories', { workspace_id: 'w1', source: '{"kind":"local-path","path":"/srv/alpha"}', verification: '{}', created_at: AT, updated_at: AT })
    row('project_assignees', { id: 'pa1', project_id: 'w1', name: 'Jack', created_at: AT, updated_at: AT })
    row('bots', { id: 'b1', project_id: 'w1', name: 'Pip', family: 'claude-code', write_scope: 'read-only', answers_in: '{"anywhere":true}', created_at: AT, updated_at: AT })
    row('worktree_leases', { id: 'l1', project_id: 'w1', holder_kind: 'bot', holder_id: 'b1', path: '/wt/1', branch: 'b', base_branch: 'main', created_at: AT, updated_at: AT, last_used_at: AT })
    row('slack_threads', { id: 'st1', project_id: 'w1', bot_id: 'b1', channel_id: 'C1', thread_ts: '1.0', session_id: 's1', slack_member_id: 'U1', created_at: AT, updated_at: AT })
    row('slack_turns', { id: 'tu1', thread_id: 'st1', session_id: 's1', slack_member_id: 'U1', prompt_seq: 1, created_at: AT, updated_at: AT })
    row('slack_deliveries', { bot_id: 'b1', event_id: 'e1', channel_id: 'C1', ts: '1.0', received_at: AT })
    row('team_members', { id: 'tm1', project_id: 'w1', display_name: 'Jack', slack_member_id: 'U1', bot_scope: 'all', created_at: AT, updated_at: AT })
    row('uptime_monitors', { id: 'um1', project_id: 'w1', name: 'Site', source_type: 'http', target: 'https://example.com', interval_seconds: 60, enabled: 1, options: '{}', created_at: AT, updated_at: AT })
    row('uptime_checks', { id: 1, monitor_id: 'um1', checked_at: AT, ok: 1, status: 'up', latency_ms: 12 })
    row('uptime_incidents', { id: 'ui1', project_id: 'w1', monitor_id: 'um1', opened_at: AT, reason: 'down', thread_id: 't1' })
    row('environments', { id: 'en1', project_id: 'w1', name: 'Production', live_source_kind: 'url', live_source_settings: '{}', created_at: AT, updated_at: AT })
    // Mastra keeps its tables in the same file; the carry-over leaves them alone.
    sqlite.exec('CREATE TABLE mastra_threads (id text PRIMARY KEY, title text)')
    row('mastra_threads', { id: 'mt1', title: 'Hello' })
    const empty = dataTables(sqlite).filter(table => (sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n === 0)
    expect(empty).toEqual([])
    const before = rowsOf(sqlite)
    sqlite.close()

    const database = openDatabase(file, { sets: testMigrationSets() })
    try {
      expect(database.legacyCarryOver).toEqual({ from: LEGACY_MIGRATIONS_TABLE, caughtUp: 0 })
      expect(database.appliedMigrations).toBe(0)
    }
    finally {
      database.close()
    }

    readBack(file, (after) => {
      expect(rowsOf(after)).toEqual(before)
      expectPerSetHistories(after)
      const shape = schemaShape(after)
      delete shape.mastra_threads
      expect(shape).toEqual(freshShape())
    })

    const again = openDatabase(file, { sets: testMigrationSets() })
    try {
      expect(again.legacyCarryOver).toBeNull()
      expect(again.appliedMigrations).toBe(0)
      expect(again.migrationSets.map(set => set.applied)).toEqual(testMigrationSets().map(() => 0))
    }
    finally {
      again.close()
    }
  })

  it.runIf(carriesPreSplitDatabases).each([
    ['in the default Drizzle table', LEGACY_MIGRATIONS_TABLE],
    ['in the platform set table the first migration-sets build used', migrationsTableFor(PLATFORM_MIGRATION_SET_ID)],
  ])('apply the legacy migrations an early database is missing, then carry it across with every row (history %s)', (_, table) => {
    const { file, sqlite } = legacyDatabase('early', { before: '0011_project_assignees', table })
    const row = insert(sqlite)
    row('organisations', { id: 'o1', slug: 'acme', name: 'Acme', created_at: AT, updated_at: AT })
    row('projects', { id: 'p1', slug: 'alpha', name: 'Alpha', color: '#123456', organisation_id: 'o1', source: '{"kind":"local-path","path":"/srv/alpha"}', verification: '{}', created_at: AT, updated_at: AT })
    row('project_modules', { id: 'm1', project_id: 'p1', module_id: 'issues', created_at: AT, updated_at: AT })
    row('users', { id: 'u1', username: 'jack', display_name: 'Jack', created_at: AT, updated_at: AT })
    row('roles', { id: 'r1', slug: 'admin', name: 'Admin', created_at: AT, updated_at: AT })
    row('user_roles', { user_id: 'u1', role_id: 'r1', created_at: AT })
    row('plugin_instances', { id: 'i1', type_id: 'codex', scope: 'project', project_id: 'p1', config: '{"label":"own"}', created_at: AT, updated_at: AT })
    row('plugin_instances', { id: 'i2', type_id: 'codex', scope: 'global', config: '{}', created_at: AT, updated_at: AT })
    row('activity_events', { id: 'a1', project_id: 'p1', type: 'issue.closed', title: 'Closed', occurred_at: AT })
    row('agent_sessions', { id: 's1', project_id: 'p1', family: 'claude-code', actor_id: 'u1', cwd: '/srv/alpha', created_at: AT, last_activity_at: AT })
    row('agent_session_events', { session_id: 's1', seq: 1, kind: 'prompt', payload: '{}', created_at: AT })
    row('chat_threads', { id: 't1', project_id: 'p1', actor_id: 'u1', agent_id: 'claude-code', current_session_id: 's1', last_activity_at: AT, created_at: AT, updated_at: AT })
    row('chat_thread_sessions', { thread_id: 't1', session_id: 's1', created_at: AT })
    row('bots', { id: 'b1', project_id: 'p1', name: 'Pip', family: 'claude-code', write_scope: 'read-only', answers_in: '{"anywhere":true}', created_at: AT, updated_at: AT })
    sqlite.close()

    const database = openDatabase(file, { sets: testMigrationSets() })
    try {
      expect(database.legacyCarryOver).toEqual({ from: table, caughtUp: LEGACY_LENGTH - 11 })
      expect(database.appliedMigrations).toBe(0)
    }
    finally {
      database.close()
    }

    readBack(file, (after) => {
      const all = (statement: string) => after.prepare(statement).all()
      expect(all('SELECT id, slug, organisation_id FROM workspaces')).toEqual([{ id: 'p1', slug: 'alpha', organisation_id: 'o1' }])
      expect(all('SELECT workspace_id, source FROM repositories')).toEqual([{ workspace_id: 'p1', source: '{"kind":"local-path","path":"/srv/alpha"}' }])
      expect(all('SELECT workspace_id, module_id FROM workspace_modules')).toEqual([{ workspace_id: 'p1', module_id: 'issues' }])
      expect(all('SELECT id, scope, workspace_id, config FROM plugin_instances ORDER BY id')).toEqual([
        { id: 'i1', scope: 'workspace', workspace_id: 'p1', config: '{"label":"own"}' },
        { id: 'i2', scope: 'global', workspace_id: null, config: '{}' },
      ])
      expect(all('SELECT workspace_id FROM activity_events')).toEqual([{ workspace_id: 'p1' }])
      expect(all('SELECT id, workspace_id FROM agent_sessions')).toEqual([{ id: 's1', workspace_id: 'p1' }])
      expect(all('SELECT session_id, seq FROM agent_session_events')).toEqual([{ session_id: 's1', seq: 1 }])
      expect(all('SELECT id, workspace_id, current_session_id FROM chat_threads')).toEqual([{ id: 't1', workspace_id: 'p1', current_session_id: 's1' }])
      expect(all('SELECT thread_id, session_id FROM chat_thread_sessions')).toEqual([{ thread_id: 't1', session_id: 's1' }])
      expect(all('SELECT user_id, role_id FROM user_roles')).toEqual([{ user_id: 'u1', role_id: 'r1' }])
      expect(all('SELECT id, project_id, name FROM bots')).toEqual([{ id: 'b1', project_id: 'p1', name: 'Pip' }])
      expectPerSetHistories(after)
      expect(schemaShape(after)).toEqual(freshShape())
    })

    const again = openDatabase(file, { sets: testMigrationSets() })
    expect(again.legacyCarryOver).toBeNull()
    expect(again.appliedMigrations).toBe(0)
    again.close()
  })

  function expectRefusedUntouched(file: string, message: string | RegExp, sets = testMigrationSets()) {
    const snapshot = (sqlite: Database.Database) => ({ tables: tableNames(sqlite), rows: rowsOf(sqlite), history: sqlite.prepare(`SELECT hash, created_at FROM "${LEGACY_MIGRATIONS_TABLE}" ORDER BY created_at`).all() })
    const before = readBack(file, snapshot)
    expect(() => openDatabase(file, { sets })).toThrow(LegacyHistoryError)
    expect(() => openDatabase(file, { sets })).toThrow(message)
    expect(readBack(file, snapshot)).toEqual(before)
  }

  it('refuse a database whose legacy entry was tampered with, naming it and changing nothing', () => {
    const { file, sqlite } = legacyDatabase('tampered')
    insert(sqlite)('organisations', { id: 'o1', slug: 'acme', name: 'Acme', created_at: AT, updated_at: AT })
    const [, , , , , plugins] = readMigrationFiles({ migrationsFolder: LEGACY_MIGRATIONS_DIR })
    sqlite.prepare(`UPDATE "${LEGACY_MIGRATIONS_TABLE}" SET hash = ? WHERE created_at = ?`).run('0'.repeat(64), plugins!.folderMillis)
    sqlite.close()
    expectRefusedUntouched(file, `entry 6 of '${LEGACY_MIGRATIONS_TABLE}' has hash ${'0'.repeat(64)}, which is not 0005_plugin_instances's`)
  })

  it('refuse a database whose legacy history has an entry the numbered history does not know', () => {
    const { file, sqlite } = legacyDatabase('unknown')
    sqlite.prepare(`INSERT INTO "${LEGACY_MIGRATIONS_TABLE}" (hash, created_at) VALUES (?, ?)`).run('f'.repeat(64), Date.now())
    sqlite.close()
    expectRefusedUntouched(file, `'${LEGACY_MIGRATIONS_TABLE}' records ${LEGACY_LENGTH + 1} migrations; the numbered history has only ${LEGACY_LENGTH}`)
  })

  it('refuse to carry a database across with a set list that does not own every legacy table', () => {
    const { file, sqlite } = legacyDatabase('partial', { before: '0011_project_assignees' })
    sqlite.close()
    expectRefusedUntouched(file, /no set being opened owns 'uptime_checks', 'uptime_incidents', 'uptime_monitors'/, testMigrationSets().filter(set => set.id !== 'uptime'))
  })

  it.runIf(!carriesPreSplitDatabases)('refuse a fully migrated database once the product no longer lists every capability that owned its tables', () => {
    const { file, sqlite } = legacyDatabase('orphaned')
    sqlite.close()
    expectRefusedUntouched(file, /no set being opened owns/)
  })

  it('refuse a database that has both the numbered history and a per-set history', () => {
    const { file, sqlite } = legacyDatabase('mixed')
    sqlite.exec(`CREATE TABLE "${migrationsTableFor('team')}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`)
    sqlite.close()
    expectRefusedUntouched(file, `per-set histories in '${migrationsTableFor('team')}'`)
  })

  it('leave a database the per-set histories built alone', () => {
    mkdirSync(join(dir, 'sets'))
    const file = join(dir, 'sets', 'sets.db')
    openDatabase(file, { sets: testMigrationSets() }).close()
    const database = openDatabase(file, { sets: testMigrationSets() })
    expect(database.legacyCarryOver).toBeNull()
    expect(database.appliedMigrations).toBe(0)
    database.close()
  })
})
