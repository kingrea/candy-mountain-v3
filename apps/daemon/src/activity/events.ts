import { randomUUID } from 'node:crypto'
import { ACTIVITY_DEFAULT_LIMIT, ACTIVITY_EVENT_TYPES, ACTIVITY_MAX_LIMIT, type ActivityEvent, type ActivityEventType, type ActivityListResponse } from '@candy-mountain/shared'
import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { activityEvents } from '../db/schema'
import { ActivityError } from './errors'

export const ACTIVITY_PAYLOAD_MAX_BYTES = 4096

export interface AppendActivityEventInput {
  projectId: string
  type: ActivityEventType
  title: string
  link?: string
  payload?: Record<string, unknown>
}

type Row = typeof activityEvents.$inferSelect

function toEvent(row: Row): ActivityEvent {
  return { ...row, payload: row.payload ?? null }
}

export type ActivityAppendListener = (event: ActivityEvent) => void

const listeners = new WeakMap<Db, Set<ActivityAppendListener>>()

/** Keyed by database so two platforms in one process (tests) never hear each other. */
export function subscribeActivityEvents(db: Db, listener: ActivityAppendListener): () => void {
  const set = listeners.get(db) ?? new Set<ActivityAppendListener>()
  listeners.set(db, set)
  set.add(listener)
  return () => void set.delete(listener)
}

export function appendActivityEvent(db: Db, input: AppendActivityEventInput): ActivityEvent {
  const payload = input.payload === undefined ? null : input.payload
  if (payload !== null && Buffer.byteLength(JSON.stringify(payload)) > ACTIVITY_PAYLOAD_MAX_BYTES) {
    throw new ActivityError('payload_too_large', `Activity payload exceeds ${ACTIVITY_PAYLOAD_MAX_BYTES} bytes`)
  }
  const row: Row = {
    id: randomUUID(),
    projectId: input.projectId,
    type: input.type,
    title: input.title,
    occurredAt: new Date().toISOString(),
    link: input.link ?? null,
    payload,
  }
  db.insert(activityEvents).values(row).run()
  const event = toEvent(row)
  for (const listener of listeners.get(db) ?? []) {
    // A broken observer must never fail the append.
    try {
      listener(event)
    }
    catch (error) {
      console.error('Activity event listener failed:', error)
    }
  }
  return event
}

export interface ListActivityOptions {
  types?: ActivityEventType[]
  /** ISO timestamp; only events at or after it. */
  since?: string
  limit?: number
  before?: string
}

// Ties on occurred_at are common (same millisecond), so the cursor carries rowid as a tiebreaker.
export const encodeCursor = (occurredAt: string, rowid: number) => Buffer.from(`${occurredAt}|${rowid}`).toString('base64url')

export function decodeCursor(cursor: string): { occurredAt: string, rowid: number } {
  const [occurredAt, rowid] = Buffer.from(cursor, 'base64url').toString().split('|')
  const id = Number(rowid)
  if (!occurredAt || !Number.isInteger(id)) throw new ActivityError('invalid_request', 'Invalid cursor')
  return { occurredAt, rowid: id }
}

export function listActivityEvents(db: Db, projectId: string, options: ListActivityOptions = {}): ActivityListResponse {
  const limit = options.limit ?? ACTIVITY_DEFAULT_LIMIT
  const rowid = sql<number>`${activityEvents}.rowid`
  const conditions = [eq(activityEvents.projectId, projectId)]
  if (options.types?.length) conditions.push(inArray(activityEvents.type, options.types))
  if (options.since) conditions.push(gte(activityEvents.occurredAt, options.since))
  if (options.before) {
    const cursor = decodeCursor(options.before)
    conditions.push(or(
      lt(activityEvents.occurredAt, cursor.occurredAt),
      and(eq(activityEvents.occurredAt, cursor.occurredAt), lt(rowid, cursor.rowid)),
    )!)
  }
  const rows = db.select({ row: activityEvents, rowid }).from(activityEvents)
    .where(and(...conditions))
    .orderBy(desc(activityEvents.occurredAt), desc(rowid))
    .limit(limit + 1)
    .all()
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    events: page.map(entry => toEvent(entry.row)),
    nextCursor: rows.length > limit && last ? encodeCursor(last.row.occurredAt, last.rowid) : null,
  }
}

export function parseListQuery(query: { type?: string, since?: string, limit?: string, before?: string }): ListActivityOptions {
  const options: ListActivityOptions = {}
  if (query.type !== undefined) {
    const types = query.type.split(',').filter(Boolean)
    const unknown = types.find(type => !(ACTIVITY_EVENT_TYPES as readonly string[]).includes(type))
    if (unknown !== undefined) throw new ActivityError('invalid_request', `Unknown activity type: ${unknown}`)
    options.types = types as ActivityEventType[]
  }
  if (query.since !== undefined) {
    const time = new Date(query.since)
    if (Number.isNaN(time.getTime())) throw new ActivityError('invalid_request', 'since must be an ISO timestamp')
    options.since = time.toISOString()
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_MAX_LIMIT) throw new ActivityError('invalid_request', `limit must be an integer from 1 to ${ACTIVITY_MAX_LIMIT}`)
    options.limit = limit
  }
  if (query.before !== undefined) {
    decodeCursor(query.before)
    options.before = query.before
  }
  return options
}
