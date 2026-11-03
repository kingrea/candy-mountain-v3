import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { uptimeMonitors } from './uptime-monitors'

export const uptimeChecks = sqliteTable('uptime_checks', {
  id: integer('id').primaryKey(),
  monitorId: text('monitor_id').notNull().references(() => uptimeMonitors.id, { onDelete: 'cascade' }),
  checkedAt: text('checked_at').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  status: text('status', { enum: ['up', 'degraded', 'down'] }).notNull(),
  httpStatus: integer('http_status'),
  latencyMs: integer('latency_ms').notNull(),
  detail: text('detail'),
}, table => [
  index('uptime_checks_monitor_id_checked_at_idx').on(table.monitorId, table.checkedAt),
])
