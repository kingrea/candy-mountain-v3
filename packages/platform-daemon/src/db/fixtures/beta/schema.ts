import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { alphaThings } from '../alpha/schema'

// References the alpha set's table the way a capability set references a platform table.
export const betaItems = sqliteTable('beta_items', {
  id: text('id').primaryKey(),
  thingId: text('thing_id').notNull().references(() => alphaThings.id, { onDelete: 'cascade' }),
})
