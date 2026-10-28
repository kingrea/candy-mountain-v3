import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export const projectAssignees = sqliteTable('project_assignees', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('project_assignees_project_name_idx').on(table.projectId, table.name),
  index('project_assignees_project_id_idx').on(table.projectId),
])
