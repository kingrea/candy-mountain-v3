import type { MonitorOptions } from '@candy-mountain/shared'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export const uptimeMonitors = sqliteTable('uptime_monitors', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sourceType: text('source_type').notNull(),
  target: text('target').notNull(),
  intervalSeconds: integer('interval_seconds').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  options: text('options', { mode: 'json' }).$type<MonitorOptions>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  index('uptime_monitors_project_id_idx').on(table.projectId),
])
