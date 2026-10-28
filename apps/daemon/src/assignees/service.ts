import { randomUUID } from 'node:crypto'
import { ASSIGNEE_NAME_MAX_LENGTH, type ProjectAssignee } from '@candy-mountain/shared'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { projectAssignees } from '../db/schema'
import { AssigneeError } from './errors'

export function listAssignees(db: Db, projectId: string): ProjectAssignee[] {
  return db.select({ name: projectAssignees.name }).from(projectAssignees)
    .where(eq(projectAssignees.projectId, projectId))
    .orderBy(asc(sql`lower(${projectAssignees.name})`), asc(projectAssignees.name))
    .all()
}

/** Idempotent; a name differing only by case resolves to the existing entry so the picker never shows near-duplicates. */
export function addAssignee(db: Db, projectId: string, rawName: string): ProjectAssignee {
  const name = rawName.trim()
  if (name === '') throw new AssigneeError('invalid_request', 'Name must not be empty')
  if (name.length > ASSIGNEE_NAME_MAX_LENGTH) throw new AssigneeError('invalid_request', `Name must be at most ${ASSIGNEE_NAME_MAX_LENGTH} characters`)
  const existing = db.select({ name: projectAssignees.name }).from(projectAssignees)
    .where(and(eq(projectAssignees.projectId, projectId), sql`lower(${projectAssignees.name}) = lower(${name})`))
    .get()
  if (existing) return existing
  const now = new Date().toISOString()
  db.insert(projectAssignees).values({ id: randomUUID(), projectId, name, createdAt: now, updatedAt: now }).run()
  return { name }
}

export function parseAddAssignee(body: unknown): string {
  const name = (body as { name?: unknown } | null)?.name
  if (typeof name !== 'string') throw new AssigneeError('invalid_request', 'Body must be { name: string }')
  return name
}
