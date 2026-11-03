import type { PluginConfig, PluginHealth, PluginScope } from '@candy-mountain/shared'
import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const pluginInstances = sqliteTable('plugin_instances', {
  id: text('id').primaryKey(),
  typeId: text('type_id').notNull(),
  scope: text('scope').$type<PluginScope>().notNull(),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  config: text('config', { mode: 'json' }).$type<PluginConfig>().notNull(),
  health: text('health', { mode: 'json' }).$type<PluginHealth>(),
  healthCheckedAt: text('health_checked_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  index('plugin_instances_workspace_id_idx').on(table.workspaceId),
  index('plugin_instances_type_id_idx').on(table.typeId),
  check('plugin_instances_scope_owner', sql`(${table.scope} = 'workspace' AND ${table.workspaceId} IS NOT NULL) OR (${table.scope} = 'global' AND ${table.workspaceId} IS NULL)`),
])
