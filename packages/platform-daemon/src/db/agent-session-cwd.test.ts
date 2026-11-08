import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, openDatabase, PLATFORM_MIGRATION_SET } from '.'

const AT = '2026-01-01T00:00:00.000Z'

/** The platform history up to and including `tag`, so a database can be built on the schema before the next migration. */
function platformMigrationsThrough(tag: string, into: string): string {
  const folder = join(into, 'migrations')
  mkdirSync(join(folder, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  const entries = journal.entries.slice(0, journal.entries.findIndex(entry => entry.tag === tag) + 1)
  for (const entry of entries) cpSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  return folder
}

describe('0001_agent_session_cwd_nullable', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cm-cwd-nullable-'))
    file = join(dir, 'daemon.db')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps every session and the rows that reference one, and turns an empty cwd into null', () => {
    const before = openDatabase(file, { sets: [{ ...PLATFORM_MIGRATION_SET, migrationsFolder: platformMigrationsThrough('0000_init', dir) }] })
    before.close()
    const seed = new Database(file)
    seed.exec(`
      INSERT INTO workspaces (id, slug, name, color, created_at, updated_at) VALUES ('w1', 'alpha', 'Alpha', 'blue', '${AT}', '${AT}');
      INSERT INTO agent_sessions (id, workspace_id, family, actor_id, cwd, created_at, last_activity_at) VALUES
        ('s-code', 'w1', 'claude-code', 'u1', '/srv/alpha', '${AT}', '${AT}'),
        ('s-native', 'w1', 'platform', 'u1', '', '${AT}', '${AT}');
      INSERT INTO agent_session_events (session_id, seq, kind, payload, created_at) VALUES
        ('s-code', 1, 'prompt', '{"kind":"prompt","text":"hi"}', '${AT}'),
        ('s-native', 1, 'prompt', '{"kind":"prompt","text":"hi"}', '${AT}');
      INSERT INTO chat_threads (id, workspace_id, actor_id, agent_id, current_session_id, last_activity_at, created_at, updated_at) VALUES
        ('t1', 'w1', 'u1', 'claude-code', 's-code', '${AT}', '${AT}', '${AT}');
      INSERT INTO chat_thread_sessions (thread_id, session_id, created_at) VALUES ('t1', 's-code', '${AT}');
    `)
    seed.close()

    const after = openDatabase(file)
    expect(after.migrationSets).toEqual([expect.objectContaining({ id: 'platform', applied: 1 })])
    after.close()

    const check = new Database(file, { readonly: true })
    expect(check.prepare('SELECT session_id FROM agent_session_events ORDER BY session_id').all()).toEqual([{ session_id: 's-code' }, { session_id: 's-native' }])
    expect(check.prepare('SELECT id, current_session_id FROM chat_threads').all()).toEqual([{ id: 't1', current_session_id: 's-code' }])
    expect(check.prepare('SELECT thread_id, session_id FROM chat_thread_sessions').all()).toEqual([{ thread_id: 't1', session_id: 's-code' }])
    expect(check.prepare('SELECT id, cwd FROM agent_sessions ORDER BY id').all()).toEqual([{ id: 's-code', cwd: '/srv/alpha' }, { id: 's-native', cwd: null }])
    expect(check.prepare(`SELECT "notnull" FROM pragma_table_info('agent_sessions') WHERE name = 'cwd'`).get()).toEqual({ notnull: 0 })
    expect(check.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    check.close()
  })
})
