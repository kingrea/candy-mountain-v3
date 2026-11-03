import type { ActivityEventType } from '@candy-mountain/shared'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const activityEvents = sqliteTable('activity_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').$type<ActivityEventType>().notNull(),
  title: text('title').notNull(),
  occurredAt: text('occurred_at').notNull(),
  link: text('link'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
}, table => [
  index('activity_events_workspace_occurred_idx').on(table.workspaceId, table.occurredAt),
  index('activity_events_type_idx').on(table.type),
])
