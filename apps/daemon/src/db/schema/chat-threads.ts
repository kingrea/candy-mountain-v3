import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { agentSessions } from './agent-sessions'
import { projects } from './projects'

export const chatThreads = sqliteTable('chat_threads', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  agentId: text('agent_id').notNull(),
  currentSessionId: text('current_session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  title: text('title'),
  model: text('model'),
  effort: text('effort'),
  unread: integer('unread', { mode: 'boolean' }).notNull().default(false),
  working: integer('working', { mode: 'boolean' }).notNull().default(false),
  lastReadAt: text('last_read_at'),
  lastActivityAt: text('last_activity_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  index('chat_threads_project_actor_activity_idx').on(table.projectId, table.actorId, table.lastActivityAt),
  index('chat_threads_current_session_idx').on(table.currentSessionId),
])

export const chatThreadSessions = sqliteTable('chat_thread_sessions', {
  threadId: text('thread_id').notNull().references(() => chatThreads.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  model: text('model'),
  effort: text('effort'),
  createdAt: text('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.threadId, table.sessionId] }),
])
