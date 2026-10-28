import type { AgentSessionEventKind, AgentSessionFamily, AgentSessionPosture, AgentSessionStatus } from '@candy-mountain/shared'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

export const agentSessions = sqliteTable('agent_sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  family: text('family').$type<AgentSessionFamily>().notNull(),
  actorId: text('actor_id').notNull(),
  cwd: text('cwd').notNull(),
  upstreamSessionId: text('upstream_session_id'),
  status: text('status').$type<AgentSessionStatus>().notNull().default('idle'),
  posture: text('posture', { mode: 'json' }).$type<AgentSessionPosture>(),
  createdAt: text('created_at').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
}, table => [
  index('agent_sessions_project_created_idx').on(table.projectId, table.createdAt),
])

export const agentSessionEvents = sqliteTable('agent_session_events', {
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  kind: text('kind').$type<AgentSessionEventKind>().notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  primaryKey({ columns: [table.sessionId, table.seq] }),
])
