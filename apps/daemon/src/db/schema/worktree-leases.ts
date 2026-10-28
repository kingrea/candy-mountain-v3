import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export type WorktreeHolderKind = 'session' | 'bot'
export type WorktreeLeaseState = 'active' | 'released'
export type WorktreeDependenciesStatus = 'installed' | 'skipped' | 'failed'

export const worktreeLeases = sqliteTable('worktree_leases', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  holderKind: text('holder_kind').$type<WorktreeHolderKind>().notNull(),
  holderId: text('holder_id').notNull(),
  path: text('path').notNull(),
  branch: text('branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  state: text('state').$type<WorktreeLeaseState>().notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
  releasedAt: text('released_at'),
  unpushedWork: integer('unpushed_work', { mode: 'boolean' }).notNull().default(false),
  unpushedReason: text('unpushed_reason'),
  inspectedAt: text('inspected_at'),
  dependenciesStatus: text('dependencies_status').$type<WorktreeDependenciesStatus>(),
  dependenciesOutput: text('dependencies_output'),
  dependenciesCheckedAt: text('dependencies_checked_at'),
}, table => [
  index('worktree_leases_project_state_idx').on(table.projectId, table.state),
  uniqueIndex('worktree_leases_active_holder_idx').on(table.holderKind, table.holderId).where(sql`${table.state} = 'active'`),
])
