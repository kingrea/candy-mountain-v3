import type { ModuleId } from '@candy-mountain/shared'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { workspaces } from './workspaces'

export const workspaceModules = sqliteTable('workspace_modules', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  moduleId: text('module_id').$type<ModuleId>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('workspace_modules_workspace_module_idx').on(table.workspaceId, table.moduleId),
  index('workspace_modules_workspace_id_idx').on(table.workspaceId),
])
