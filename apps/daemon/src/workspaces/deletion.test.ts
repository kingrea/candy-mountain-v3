import { WORKSPACES_PATH, type Workspace } from '@candy-mountain/shared'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { isCapabilityDefinition, type CapabilityDefinition } from '../capabilities/definition'
import { fixtureDefinition } from '../capabilities/fixtures'
import type { Db } from '../db'
import { notificationDeliveredKey, notificationRulesKey } from '../notifications/rules'
import type { Platform } from '../platform'
import { createPluginInstance } from '../plugins/instances/instances'
import { createTempDataDir, type TempDataDir } from '../testing'
import { CAPABILITY_DEFINITIONS, platformApp, startTestPlatform } from '../testing/platform'
import { createWorkspace, findWorkspaceBySlug } from './workspaces'

/** Tables no workspace owns a row of; the workspace's own row is checked by id. */
const UNKEYED_TABLES = new Set(['organisations', 'users', 'roles', 'user_roles', 'user_passwords', 'auth_sessions', 'role_grants', 'platform_meta', 'workspaces'])

/** Keyed to the workspace through a column with no foreign key. */
const KEYS_WITHOUT_FOREIGN_KEY: Record<string, Record<string, { table: string, column: string }>> = {
  slack_deliveries: { bot_id: { table: 'bots', column: 'id' } },
}

/** Seeded through its service, because its delete hook reads the row's config. */
const SEEDED_BY_SERVICE = new Set(['plugin_instances'])

interface Column { name: string, type: string, pk: number }
interface ForeignKey { table: string, from: string, to: string }

const tableNames = (db: Db) =>
  db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_migrations%' ORDER BY name`).map(row => row.name)

const columnsOf = (db: Db, table: string) => db.all<Column>(sql.raw(`PRAGMA table_info("${table}")`))

function foreignKeysOf(db: Db, table: string): ForeignKey[] {
  const declared = db.all<ForeignKey>(sql.raw(`PRAGMA foreign_key_list("${table}")`)).map(({ table, from, to }) => ({ table, from, to }))
  const logical = Object.entries(KEYS_WITHOUT_FOREIGN_KEY[table] ?? {}).map(([from, target]) => ({ table: target.table, from, to: target.column }))
  return [...declared, ...logical]
}

/** Keyed tables in an order where every referenced table comes first; a table that reaches no workspace fails the test until it is classified. */
function keyedTables(db: Db): { table: string, foreignKeys: ForeignKey[] }[] {
  const pending = new Map(tableNames(db).filter(t => !UNKEYED_TABLES.has(t)).map(t => [t, foreignKeysOf(db, t).filter(fk => fk.table !== t)]))
  const ordered: { table: string, foreignKeys: ForeignKey[] }[] = []
  const placed = new Set(['workspaces'])
  while (pending.size) {
    const ready = [...pending].find(([, fks]) => fks.every(fk => placed.has(fk.table) || UNKEYED_TABLES.has(fk.table)) && fks.some(fk => placed.has(fk.table)))
    if (!ready) throw new Error(`Tables reaching no workspace: ${[...pending.keys()].join(', ')}; key them to one or list them as unkeyed`)
    const [table, foreignKeys] = ready
    ordered.push({ table, foreignKeys })
    placed.add(table)
    pending.delete(table)
  }
  return ordered
}

/** One row per keyed table, every value tagged so a later scan can find anything left over. */
function seedEveryTable(db: Db, workspace: Workspace, tag: string): void {
  const seeded = new Map<string, Record<string, unknown>>([['workspaces', { id: workspace.id }]])
  for (const { table, foreignKeys } of keyedTables(db)) {
    if (SEEDED_BY_SERVICE.has(table)) continue
    const row: Record<string, unknown> = {}
    const columns = columnsOf(db, table)
    const rowid = columns.filter(c => c.pk).length === 1 ? columns.find(c => c.pk && /^INTEGER$/i.test(c.type)) : undefined
    for (const { name, type } of columns) {
      const fk = foreignKeys.find(key => key.from === name)
      if (fk) row[name] = seeded.get(fk.table)?.[fk.to]
      else if (name === rowid?.name) continue
      else if (/INT|REAL|NUM/i.test(type)) row[name] = 1
      else {
        const value = `${tag}.${table}.${name}`.replaceAll('_', '-')
        // Quoted, so a JSON column still parses; keys stay bare, as secret owners are built from them.
        row[name] = columns.some(c => c.pk && c.name === name) ? value : JSON.stringify(value)
      }
    }
    const names = Object.keys(row)
    db.run(sql`INSERT INTO ${sql.identifier(table)} (${sql.join(names.map(n => sql.identifier(n)), sql`, `)}) VALUES (${sql.join(names.map(n => sql`${row[n]}`), sql`, `)})`)
    seeded.set(table, row)
  }
  for (const key of [notificationRulesKey(workspace.id), notificationDeliveredKey(workspace.id)]) {
    db.run(sql`INSERT INTO platform_meta (key, value, updated_at) VALUES (${key}, '{}', '2026-01-01T00:00:00.000Z')`)
  }
}

/** Every table holding a row that mentions any of the needles. */
function tablesMentioning(db: Db, ...needles: string[]): string[] {
  return tableNames(db).filter(table =>
    db.all<Record<string, unknown>>(sql`SELECT * FROM ${sql.identifier(table)}`).some(row => needles.some(needle => JSON.stringify(row).includes(needle))),
  )
}

describe('deleting a workspace', () => {
  const open: Platform[] = []
  const temps: TempDataDir[] = []

  afterEach(async () => {
    await Promise.all(open.splice(0).map(p => p.close()))
    temps.splice(0).forEach(t => t.cleanup())
  })

  function start(options: Parameters<typeof startTestPlatform>[1] = {}) {
    const temp = createTempDataDir()
    temps.push(temp)
    const platform = startTestPlatform(temp.root, options)
    open.push(platform)
    const workspaces = ['Doomed', 'Kept'].map((name) => {
      const workspace = createWorkspace(platform.db, { name })
      seedEveryTable(platform.db, workspace, `w-${workspace.slug}`)
      createPluginInstance({ db: platform.db, pluginTypes: platform.pluginTypes, secrets: platform.secrets.writeOnly }, { type: 'claude-code', scope: 'workspace', workspaceId: workspace.id, config: {} })
      return workspace
    })
    return { platform, app: platformApp(platform), doomed: workspaces[0]!, kept: workspaces[1]! }
  }

  const keyed = (platform: Platform) => keyedTables(platform.db).map(({ table }) => table)

  it('leaves no row of any capability or the platform referring to it, and keeps every other workspace\'s', async () => {
    const { platform, app, doomed, kept } = start()
    expect(tablesMentioning(platform.db, doomed.id, 'w-doomed')).toEqual(expect.arrayContaining([...keyed(platform), 'platform_meta', 'workspaces']))

    expect((await app.request(`${WORKSPACES_PATH}/${doomed.slug}`, { method: 'DELETE' })).status).toBe(204)

    expect(findWorkspaceBySlug(platform.db, doomed.slug)).toBeNull()
    expect(tablesMentioning(platform.db, doomed.id, 'w-doomed')).toEqual([])
    expect(tablesMentioning(platform.db, kept.id, 'w-kept')).toEqual(expect.arrayContaining([...keyed(platform), 'platform_meta', 'workspaces']))
  })

  it('keeps the workspace and every row when a deletion hook throws after others have run', async () => {
    const order: string[] = []
    const bots = CAPABILITY_DEFINITIONS.filter(isCapabilityDefinition).find(d => d.id === 'bots')!
    const tracedBots: CapabilityDefinition = { ...bots, start: (context) => {
      const runtime = bots.start!(context)
      return { ...runtime, onWorkspaceDeleted: async (workspace) => {
        await runtime.onWorkspaceDeleted?.(workspace)
        order.push('bots')
      } }
    } }
    // Started first, so its hook runs last.
    const wrecker = fixtureDefinition('wrecker', { manifest: null, start: () => ({ onWorkspaceDeleted: () => {
      order.push('wrecker')
      throw new Error('wrecker keeps it')
    } }) })
    const { platform, app, doomed } = start({ capabilities: [wrecker, ...CAPABILITY_DEFINITIONS.map(d => (d === bots ? tracedBots : d))] })
    const before = tablesMentioning(platform.db, doomed.id, 'w-doomed')

    expect((await app.request(`${WORKSPACES_PATH}/${doomed.slug}`, { method: 'DELETE' })).status).toBe(500)

    expect(order).toEqual(['bots', 'wrecker'])
    expect(findWorkspaceBySlug(platform.db, doomed.slug)).not.toBeNull()
    expect(tablesMentioning(platform.db, doomed.id, 'w-doomed')).toEqual(before)
  })
})
