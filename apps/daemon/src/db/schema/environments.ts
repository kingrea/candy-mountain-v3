import type { LiveVersionSettings } from '@candy-mountain/shared'
import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export const environments = sqliteTable('environments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  liveSourceKind: text('live_source_kind').notNull(),
  liveSourceSettings: text('live_source_settings', { mode: 'json' }).$type<LiveVersionSettings>().notNull(),
  deployKind: text('deploy_kind'),
  deploySettings: text('deploy_settings', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('environments_project_id_name_idx').on(table.projectId, table.name),
])
