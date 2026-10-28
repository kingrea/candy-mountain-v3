import type { TeamBotScope } from '@candy-mountain/shared'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export const teamMembers = sqliteTable('team_members', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  email: text('email'),
  slackMemberId: text('slack_member_id').notNull(),
  botScope: text('bot_scope', { mode: 'json' }).$type<TeamBotScope>().notNull(),
  lastActiveAt: text('last_active_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  index('team_members_project_id_idx').on(table.projectId),
  uniqueIndex('team_members_project_slack_idx').on(table.projectId, table.slackMemberId),
])
