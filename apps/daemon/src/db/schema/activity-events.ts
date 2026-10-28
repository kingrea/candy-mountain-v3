import type { ActivityEventType } from '@candy-mountain/shared'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export const activityEvents = sqliteTable('activity_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: text('type').$type<ActivityEventType>().notNull(),
  title: text('title').notNull(),
  occurredAt: text('occurred_at').notNull(),
  link: text('link'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
}, table => [
  index('activity_events_project_occurred_idx').on(table.projectId, table.occurredAt),
  index('activity_events_type_idx').on(table.type),
])
