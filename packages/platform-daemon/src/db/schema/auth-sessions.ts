import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './auth'

export const userPasswords = sqliteTable('user_passwords', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const authSessions = sqliteTable('auth_sessions', {
  /** SHA-256 of the cookie token, so a leaked database cannot be replayed as cookies. */
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
}, table => [
  index('auth_sessions_user_id_idx').on(table.userId),
  index('auth_sessions_expires_at_idx').on(table.expiresAt),
])
