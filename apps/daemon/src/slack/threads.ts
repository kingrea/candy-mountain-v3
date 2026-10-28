import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { slackDeliveries, slackThreads, type SlackThreadState } from '../db/schema'

export interface SlackThread {
  id: string
  projectId: string
  botId: string
  teamId: string | null
  channelId: string
  threadTs: string
  sessionId: string
  /** The roster member who opened the thread; it stops being answered once they leave the roster. */
  slackMemberId: string
  state: SlackThreadState
  turnCount: number
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export interface SlackThreadRef {
  botId: string
  channelId: string
  threadTs: string
}

/** The bot session holder id for a Slack thread; the mapping row is the source of truth, this only keys the session. */
export const slackThreadHolderId = ({ botId, channelId, threadTs }: SlackThreadRef) => `${botId}:${channelId}:${threadTs}`

const toThread = (row: typeof slackThreads.$inferSelect): SlackThread => ({ ...row })

export function findSlackThread(db: Db, ref: SlackThreadRef): SlackThread | null {
  const row = db.select().from(slackThreads)
    .where(and(eq(slackThreads.botId, ref.botId), eq(slackThreads.channelId, ref.channelId), eq(slackThreads.threadTs, ref.threadTs))).get()
  return row ? toThread(row) : null
}

export function findSlackThreadById(db: Db, id: string): SlackThread | null {
  const row = db.select().from(slackThreads).where(eq(slackThreads.id, id)).get()
  return row ? toThread(row) : null
}

export function findSlackThreadBySession(db: Db, sessionId: string): SlackThread | null {
  const row = db.select().from(slackThreads).where(eq(slackThreads.sessionId, sessionId)).get()
  return row ? toThread(row) : null
}

export interface InsertSlackThreadInput extends SlackThreadRef {
  projectId: string
  teamId: string | null
  sessionId: string
  slackMemberId: string
  at: string
}

export function insertSlackThread(db: Db, input: InsertSlackThreadInput): SlackThread {
  const { at, ...fields } = input
  const row = { id: randomUUID(), ...fields, state: 'open' as const, turnCount: 0, createdAt: at, updatedAt: at, closedAt: null }
  db.insert(slackThreads).values(row).run()
  return row
}

export function countSlackThreadTurn(db: Db, id: string, at: string): void {
  const row = db.select({ turnCount: slackThreads.turnCount }).from(slackThreads).where(eq(slackThreads.id, id)).get()
  if (row) db.update(slackThreads).set({ turnCount: row.turnCount + 1, updatedAt: at }).where(eq(slackThreads.id, id)).run()
}

/** A fresh session on the same thread, after the previous worktree went away. */
export function reopenSlackThread(db: Db, id: string, sessionId: string, at: string): void {
  db.update(slackThreads).set({ sessionId, state: 'open', closedAt: null, updatedAt: at }).where(eq(slackThreads.id, id)).run()
}

export function closeSlackThread(db: Db, id: string, at: string): void {
  db.update(slackThreads).set({ state: 'closed', closedAt: at, updatedAt: at }).where(eq(slackThreads.id, id)).run()
}

export interface SlackDelivery {
  botId: string
  eventId: string
  channelId: string
  ts: string
}

/** False when the event id, or the same message under another event id, was already delivered to this bot. */
export function claimSlackDelivery(db: Db, delivery: SlackDelivery, at: string): boolean {
  const result = db.insert(slackDeliveries).values({ ...delivery, receivedAt: at }).onConflictDoNothing().run()
  return result.changes > 0
}
