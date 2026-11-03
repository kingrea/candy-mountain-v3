import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const alphaThings = sqliteTable('alpha_things', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
})
