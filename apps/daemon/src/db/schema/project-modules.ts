import type { ModuleId } from '@candy-mountain/shared'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export const projectModules = sqliteTable('project_modules', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  moduleId: text('module_id').$type<ModuleId>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('project_modules_project_module_idx').on(table.projectId, table.moduleId),
  index('project_modules_project_id_idx').on(table.projectId),
])
