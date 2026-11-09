import { sql } from 'drizzle-orm'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { uptimeMonitors } from './uptime-monitors'
import { chatThreads, workspaces } from '@crab-shack/platform-daemon'

export const uptimeIncidents = sqliteTable('uptime_incidents', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  monitorId: text('monitor_id').notNull().references(() => uptimeMonitors.id, { onDelete: 'cascade' }),
  openedAt: text('opened_at').notNull(),
  closedAt: text('closed_at'),
  reason: text('reason').notNull(),
  threadId: text('thread_id').references(() => chatThreads.id, { onDelete: 'set null' }),
}, table => [
  index('uptime_incidents_project_opened_idx').on(table.projectId, table.openedAt),
  index('uptime_incidents_monitor_opened_idx').on(table.monitorId, table.openedAt),
  uniqueIndex('uptime_incidents_open_monitor_idx').on(table.monitorId).where(sql`${table.closedAt} IS NULL`),
])
