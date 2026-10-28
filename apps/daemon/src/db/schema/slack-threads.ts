import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { agentSessions } from './agent-sessions'
import { bots } from './bots'
import { projects } from './projects'

export type SlackThreadState = 'open' | 'closed'

export const slackThreads = sqliteTable('slack_threads', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  botId: text('bot_id').notNull().references(() => bots.id, { onDelete: 'cascade' }),
  teamId: text('team_id'),
  channelId: text('channel_id').notNull(),
  threadTs: text('thread_ts').notNull(),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  slackMemberId: text('slack_member_id').notNull(),
  state: text('state').$type<SlackThreadState>().notNull().default('open'),
  turnCount: integer('turn_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  closedAt: text('closed_at'),
}, table => [
  uniqueIndex('slack_threads_bot_channel_thread_idx').on(table.botId, table.channelId, table.threadTs),
  index('slack_threads_session_id_idx').on(table.sessionId),
])

export const slackDeliveries = sqliteTable('slack_deliveries', {
  botId: text('bot_id').notNull(),
  eventId: text('event_id').notNull(),
  channelId: text('channel_id').notNull(),
  ts: text('ts').notNull(),
  receivedAt: text('received_at').notNull(),
}, table => [
  primaryKey({ columns: [table.botId, table.eventId] }),
  // A mention inside a thread arrives as both app_mention and message with different event ids.
  uniqueIndex('slack_deliveries_bot_message_idx').on(table.botId, table.channelId, table.ts),
])

/** finished: the Slack message is final but the turn-end hook has not run yet. */
export type SlackTurnState = 'open' | 'finished' | 'completed'

/** One progress message per turn; the session log holds the content, this holds where it went and how far. */
export const slackTurns = sqliteTable('slack_turns', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull().references(() => slackThreads.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  slackMemberId: text('slack_member_id').notNull(),
  promptSeq: integer('prompt_seq').notNull(),
  sentSeq: integer('sent_seq').notNull().default(0),
  mode: text('mode').$type<'stream' | 'message'>(),
  messageTs: text('message_ts'),
  state: text('state').$type<SlackTurnState>().notNull().default('open'),
  resumes: integer('resumes').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
}, table => [
  index('slack_turns_thread_id_idx').on(table.threadId),
  index('slack_turns_state_idx').on(table.state),
])
