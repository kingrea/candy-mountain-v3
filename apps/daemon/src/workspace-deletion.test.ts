import { WORKSPACES_PATH, type Workspace } from '@crab-shack/platform-sdk'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { createPluginInstance, createWorkspace, findWorkspaceBySlug, MasterKey, notificationDeliveredKey, notificationRulesKey, type Db, type Platform } from '@crab-shack/platform-daemon'
import { fixtureDefinition, fixturePluginType, platformApp } from '@crab-shack/platform-daemon/testing'
import { CANDY_MOUNTAIN } from './candy-mountain'
import { candyMountainWith, createTempDataDir, startTestPlatform, type TempDataDir } from './testing'

/** Tables no workspace owns a row of; the workspace's own row is checked by id. */
/** A workspace-scoped type whose instances carry a secret, whatever plugin types the product lists. */
const PROBE_PLUGIN_TYPE = fixturePluginType('probe')

const UNKEYED_TABLES = new Set(['organisations', 'users', 'roles', 'user_roles', 'user_passwords', 'auth_sessions', 'role_grants', 'platform_meta', 'workspaces'])

/** Seeded through its service, because its delete hook reads the row's config. */
const SEEDED_BY_SERVICE = new Set(['plugin_instances'])

interface Column { name: string, type: string, pk: number }
interface ForeignKey { table: string, from: string, to: string }

const tableNames = (db: Db) =>
  db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_migrations%' ORDER BY name`).map(row => row.name)

const columnsOf = (db: Db, table: string) => db.all<Column>(sql.raw(`PRAGMA table_info("${table}")`))

/** A `<name>_id` column with no declared foreign key counts as one to the table `<name>s` when it exists. */
function foreignKeysOf(db: Db, table: string): ForeignKey[] {
  const declared = db.all<ForeignKey>(sql.raw(`PRAGMA foreign_key_list("${table}")`)).map(({ table, from, to }) => ({ table, from, to }))
  const tables = new Set(tableNames(db))
  const logical = columnsOf(db, table)
    .filter(({ name }) => !declared.some(fk => fk.from === name))
    .flatMap(({ name }) => (/^(.+)_id$/.test(name) && tables.has(`${name.slice(0, -3)}s`) ? [{ table: `${name.slice(0, -3)}s`, from: name, to: 'id' }] : []))
  return [...declared, ...logical]
}

// Mastra creates its storage asynchronously after boot, so whether a scan sees it depends on timing; none of it is keyed to a workspace.
const isMastraTable = (table: string) => table.startsWith('mastra_')

/** Keyed tables in an order where every referenced table comes first; a table that reaches no workspace fails the test until it is classified. */
function keyedTables(db: Db): { table: string, foreignKeys: ForeignKey[] }[] {
  const pending = new Map(tableNames(db).filter(t => !UNKEYED_TABLES.has(t) && !isMastraTable(t)).map(t => [t, foreignKeysOf(db, t).filter(fk => fk.table !== t)]))
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
  const meta = [
    [notificationRulesKey(workspace.id), '{}'],
    [notificationDeliveredKey(workspace.id), '{}'],
  ]
  for (const [key, value] of meta) {
    db.run(sql`INSERT INTO platform_meta (key, value, updated_at) VALUES (${key}, ${value}, '2026-01-01T00:00:00.000Z')`)
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
    options = { pluginTypes: [...CANDY_MOUNTAIN.pluginTypes, PROBE_PLUGIN_TYPE], ...options }
    const temp = createTempDataDir()
    temps.push(temp)
    const platform = startTestPlatform(temp.root, { secretsKey: MasterKey.generate(), ...options })
    open.push(platform)
    const workspaces = ['Doomed', 'Kept'].map((name) => {
      const workspace = createWorkspace(platform.db, { name })
      seedEveryTable(platform.db, workspace, `w-${workspace.slug}`)
      const instance = createPluginInstance({ db: platform.db, pluginTypes: platform.pluginTypes, secrets: platform.secrets.writeOnly }, { type: PROBE_PLUGIN_TYPE.id, scope: 'workspace', workspaceId: workspace.id, config: { account: 'probe' }, secrets: { token: 'probe-token' } })
      const secretOwners = [`plugin:${instance.id}`]
      for (const owner of secretOwners) platform.secrets.set(owner, 'token', 'kept until the deletion commits')
      return { ...workspace, secretOwners }
    })
    return { platform, app: platformApp(platform), doomed: workspaces[0]!, kept: workspaces[1]! }
  }

  const keyed = (platform: Platform) => keyedTables(platform.db).map(({ table }) => table)
  const secretsLeft = (platform: Platform, owners: string[]) => owners.filter(owner => platform.secrets.isSet(owner, 'token'))

  it('leaves no row of any capability or the platform referring to it, and keeps every other workspace\'s', async () => {
    const { platform, app, doomed, kept } = start()
    expect(tablesMentioning(platform.db, doomed.id, 'w-doomed')).toEqual(expect.arrayContaining([...keyed(platform), 'platform_meta', 'workspaces']))

    expect((await app.request(`${WORKSPACES_PATH}/${doomed.slug}`, { method: 'DELETE' })).status).toBe(204)

    expect(findWorkspaceBySlug(platform.db, doomed.slug)).toBeNull()
    expect(tablesMentioning(platform.db, doomed.id, 'w-doomed')).toEqual([])
    expect(tablesMentioning(platform.db, kept.id, 'w-kept')).toEqual(expect.arrayContaining([...keyed(platform), 'platform_meta', 'workspaces']))
    expect(secretsLeft(platform, doomed.secretOwners)).toEqual([])
    expect(secretsLeft(platform, kept.secretOwners)).toEqual(kept.secretOwners)
  })

  it('keeps the workspace, every row, and its secrets when a deletion hook throws after others have run', async () => {
    const order: string[] = []
    // Started first, so its hook runs last.
    const wrecker = fixtureDefinition('wrecker', { manifest: null, start: () => ({ onWorkspaceDeleted: () => {
      order.push('wrecker')
      throw new Error('wrecker keeps it')
    } }) })
    const witness = fixtureDefinition('witness', { manifest: null, start: () => ({ onWorkspaceDeleted: () => {
      order.push('witness')
    } }) })
    const { platform, app, doomed } = start({ capabilities: [wrecker, witness, ...candyMountainWith({}).capabilities] })
    const before = tablesMentioning(platform.db, doomed.id, 'w-doomed')

    expect((await app.request(`${WORKSPACES_PATH}/${doomed.slug}`, { method: 'DELETE' })).status).toBe(500)

    expect(order).toEqual(['witness', 'wrecker'])
    expect(findWorkspaceBySlug(platform.db, doomed.slug)).not.toBeNull()
    expect(tablesMentioning(platform.db, doomed.id, 'w-doomed')).toEqual(before)
    expect(secretsLeft(platform, doomed.secretOwners)).toEqual(doomed.secretOwners)
  })
})
