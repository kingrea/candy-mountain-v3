import type { RepositorySource, RepositoryVerification } from '../wire'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { workspaces } from '@crab-shack/platform-daemon'

/** The repository capability's: one row per workspace that has a repository, gone with the workspace. */
export const repositories = sqliteTable('repositories', {
  workspaceId: text('workspace_id').primaryKey().references(() => workspaces.id, { onDelete: 'cascade' }),
  // A discriminated union keyed on `kind`, so new source kinds need no column changes.
  source: text('source', { mode: 'json' }).$type<RepositorySource>().notNull(),
  verification: text('verification', { mode: 'json' }).$type<RepositoryVerification>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
