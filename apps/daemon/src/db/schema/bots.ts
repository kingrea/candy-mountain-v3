import type { BotAnswersIn, BotFamily, BotPersonaStatus, BotWriteScope } from '@candy-mountain/shared'
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  family: text('family').$type<BotFamily>().notNull(),
  writeScope: text('write_scope').$type<BotWriteScope>().notNull(),
  baseBranch: text('base_branch'),
  personaName: text('persona_name'),
  answersIn: text('answers_in', { mode: 'json' }).$type<BotAnswersIn>().notNull(),
  personaStatus: text('persona_status').$type<BotPersonaStatus>().notNull().default('unverified'),
  personaCheckedAt: text('persona_checked_at'),
  personaReason: text('persona_reason'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  index('bots_project_id_idx').on(table.projectId),
])
