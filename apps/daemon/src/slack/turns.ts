import { randomUUID } from 'node:crypto'
import { desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db'
import { slackTurns, type SlackTurnState } from '../db/schema'
import type { SlackProgressMode, SlackTurnMessage } from './progress'

export interface SlackTurn {
  id: string
  threadId: string
  sessionId: string
  /** Whose message started the turn; a native stream is addressed to them. */
  slackMemberId: string
  /** The log row of the prompt; every later row of the session belongs to this turn. */
  promptSeq: number
  /** The last log row Slack has seen. */
  sentSeq: number
  mode: SlackProgressMode | null
  messageTs: string | null
  state: SlackTurnState
  resumes: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

const toTurn = (row: typeof slackTurns.$inferSelect): SlackTurn => ({ ...row })

export function openSlackTurn(db: Db, input: { threadId: string, sessionId: string, slackMemberId: string, promptSeq: number, at: string }): SlackTurn {
  const { at, ...fields } = input
  const row = { id: randomUUID(), ...fields, sentSeq: 0, mode: null, messageTs: null, state: 'open' as const, resumes: 0, createdAt: at, updatedAt: at, completedAt: null }
  db.insert(slackTurns).values(row).run()
  return row
}

export function findSlackTurn(db: Db, id: string): SlackTurn | null {
  const row = db.select().from(slackTurns).where(eq(slackTurns.id, id)).get()
  return row ? toTurn(row) : null
}

/** Turns a restart has to finish: open ones still need their message, finished ones their turn-end hook. */
export function listOpenSlackTurns(db: Db): SlackTurn[] {
  return db.select().from(slackTurns).where(inArray(slackTurns.state, ['open', 'finished'])).orderBy(slackTurns.createdAt).all().map(toTurn)
}

/** The most recent turn of a thread, for whoever needs the message a bot last spoke in. */
export function latestSlackTurn(db: Db, threadId: string): SlackTurn | null {
  const row = db.select().from(slackTurns).where(eq(slackTurns.threadId, threadId)).orderBy(desc(slackTurns.createdAt), desc(slackTurns.promptSeq)).limit(1).get()
  return row ? toTurn(row) : null
}

export function recordSlackTurnMessage(db: Db, id: string, message: SlackTurnMessage, at: string): void {
  db.update(slackTurns).set({ mode: message.mode, messageTs: message.ts, updatedAt: at }).where(eq(slackTurns.id, id)).run()
}

export function recordSlackTurnSent(db: Db, id: string, sentSeq: number, at: string): void {
  db.update(slackTurns).set({ sentSeq, updatedAt: at }).where(eq(slackTurns.id, id)).run()
}

export function countSlackTurnResume(db: Db, id: string, at: string): void {
  const row = db.select({ resumes: slackTurns.resumes }).from(slackTurns).where(eq(slackTurns.id, id)).get()
  if (row) db.update(slackTurns).set({ resumes: row.resumes + 1, updatedAt: at }).where(eq(slackTurns.id, id)).run()
}

export function finishSlackTurn(db: Db, id: string, at: string): void {
  db.update(slackTurns).set({ state: 'finished', updatedAt: at }).where(eq(slackTurns.id, id)).run()
}

export function completeSlackTurn(db: Db, id: string, at: string): void {
  db.update(slackTurns).set({ state: 'completed', completedAt: at, updatedAt: at }).where(eq(slackTurns.id, id)).run()
}

export const slackTurnMessage = (turn: SlackTurn, thread: { channelId: string, threadTs: string }): SlackTurnMessage | null =>
  (turn.mode && turn.messageTs ? { channel: thread.channelId, threadTs: thread.threadTs, ts: turn.messageTs, mode: turn.mode } : null)
