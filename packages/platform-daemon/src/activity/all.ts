import { ACTIVITY_DEFAULT_LIMIT, type ActivityEventTypesResponse, type ApiErrorBody, type CrossWorkspaceActivityResponse } from '@candy-mountain/platform-sdk'
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import type { Db } from '../db'
import { activityEvents, workspaces } from '../db/schema'
import { ActivityError } from './errors'
import { decodeCursor, encodeCursor, parseListQuery, type ListActivityOptions } from './events'
import { activityEventTypesFor } from './types'

// Every signed-in actor sees every non-archived workspace today; filter here once per-workspace visibility exists.
export function listAllActivityEvents(db: Db, options: ListActivityOptions = {}): CrossWorkspaceActivityResponse {
  const limit = options.limit ?? ACTIVITY_DEFAULT_LIMIT
  const rowid = sql<number>`${activityEvents}.rowid`
  const conditions = [isNull(workspaces.archivedAt)]
  if (options.types?.length) conditions.push(inArray(activityEvents.type, options.types))
  if (options.since) conditions.push(gte(activityEvents.occurredAt, options.since))
  if (options.before) {
    const cursor = decodeCursor(options.before)
    conditions.push(or(
      lt(activityEvents.occurredAt, cursor.occurredAt),
      and(eq(activityEvents.occurredAt, cursor.occurredAt), lt(rowid, cursor.rowid)),
    )!)
  }
  const rows = db.select({ row: activityEvents, rowid, slug: workspaces.slug, name: workspaces.name, color: workspaces.color })
    .from(activityEvents)
    .innerJoin(workspaces, eq(workspaces.id, activityEvents.workspaceId))
    .where(and(...conditions))
    .orderBy(desc(activityEvents.occurredAt), desc(rowid))
    .limit(limit + 1)
    .all()
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    events: page.map(entry => ({
      ...entry.row,
      payload: entry.row.payload ?? null,
      workspace: { slug: entry.slug, name: entry.name, color: entry.color },
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.row.occurredAt, last.rowid) : null,
  }
}

export function allActivityRoutes() {
  const app = new Hono<AppEnv>()
  app.onError((error, c) => {
    if (error instanceof ActivityError) {
      return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    }
    throw error
  })
  app.get('/types', c => c.json<ActivityEventTypesResponse>({ types: [...activityEventTypesFor(c.var.db).info()] }))
  app.get('/', c => c.json(listAllActivityEvents(c.var.db, parseListQuery(c.req.query(), activityEventTypesFor(c.var.db)))))
  return app
}
