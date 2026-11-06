import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Only the columns the scope check reads; the bots capability owns the table and this declaration is outside the schema set, so it generates no migration.
export const projectBots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
})
