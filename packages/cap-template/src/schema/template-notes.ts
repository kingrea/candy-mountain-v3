import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { workspaces } from '@candy-mountain/platform-daemon'

// The cascade is why deleting a workspace needs no onWorkspaceDeleted hook here.
export const templateNotes = sqliteTable('template_notes', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  index('template_notes_workspace_id_idx').on(table.workspaceId),
])
