import type { PathVerification, ProjectSource } from '@candy-mountain/shared'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const organisations = sqliteTable('organisations', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  organisationId: text('organisation_id').references(() => organisations.id, { onDelete: 'set null' }),
  archivedAt: text('archived_at'),
  // A discriminated union keyed on `kind`, so new source kinds need no column changes.
  source: text('source', { mode: 'json' }).$type<ProjectSource>().notNull(),
  verification: text('verification', { mode: 'json' }).$type<PathVerification>().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('projects_organisation_id_idx').on(table.organisationId)])
