import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const platformMeta = sqliteTable('platform_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})
