import type { ChatThread, ChatThreadSession } from '@candy-mountain/shared'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { chatThreads, chatThreadSessions } from '../db/schema'

export type ThreadRow = typeof chatThreads.$inferSelect

export function insertThread(db: Db, thread: ThreadRow, session: ChatThreadSession): ChatThread {
  db.transaction((tx) => {
    tx.insert(chatThreads).values(thread).run()
    tx.insert(chatThreadSessions).values({ threadId: thread.id, ...session }).run()
  })
  return thread
}

export function findThread(db: Db, id: string): ChatThread | null {
  return db.select().from(chatThreads).where(eq(chatThreads.id, id)).get() ?? null
}

export function listThreads(db: Db, projectId: string, actorId: string, agentIds: readonly string[]): ChatThread[] {
  if (!agentIds.length) return []
  return db.select().from(chatThreads)
    .where(and(eq(chatThreads.projectId, projectId), eq(chatThreads.actorId, actorId), inArray(chatThreads.agentId, [...agentIds])))
    .orderBy(desc(chatThreads.lastActivityAt), desc(chatThreads.createdAt))
    .all()
}

export function allThreads(db: Db): ChatThread[] {
  return db.select().from(chatThreads).all()
}

export type ThreadPatch = Partial<Pick<ThreadRow, 'title' | 'model' | 'effort' | 'unread' | 'working' | 'lastReadAt' | 'lastActivityAt' | 'updatedAt'>>

export function updateThread(db: Db, id: string, patch: ThreadPatch): void {
  db.update(chatThreads).set(patch).where(eq(chatThreads.id, id)).run()
}

export function switchThreadSession(db: Db, id: string, session: ChatThreadSession, patch: ThreadPatch): void {
  db.transaction((tx) => {
    tx.insert(chatThreadSessions).values({ threadId: id, ...session }).run()
    tx.update(chatThreads).set({ ...patch, currentSessionId: session.sessionId }).where(eq(chatThreads.id, id)).run()
  })
}

export function listThreadSessions(db: Db, threadId: string): ChatThreadSession[] {
  return db.select({ sessionId: chatThreadSessions.sessionId, model: chatThreadSessions.model, effort: chatThreadSessions.effort, createdAt: chatThreadSessions.createdAt })
    .from(chatThreadSessions)
    .where(eq(chatThreadSessions.threadId, threadId))
    .orderBy(asc(chatThreadSessions.createdAt), asc(sql`rowid`))
    .all()
}
