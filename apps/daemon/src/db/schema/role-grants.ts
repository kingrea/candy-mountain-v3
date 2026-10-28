import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { roles } from './auth'

export const roleGrants = sqliteTable('role_grants', {
  id: text('id').primaryKey(),
  roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  targetKind: text('target_kind', { enum: ['module', 'capability'] }).notNull(),
  targetId: text('target_id').notNull(),
  rungs: text('rungs', { mode: 'json' }).$type<Record<string, string>>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  uniqueIndex('role_grants_role_target_idx').on(table.roleId, table.targetKind, table.targetId),
])
