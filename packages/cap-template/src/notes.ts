import { randomUUID } from 'node:crypto'
import { workspaceViewRoute, type Workspace } from '@candy-mountain/platform-sdk'
import { asc, eq } from 'drizzle-orm'
import { appendActivityEvent, type Db } from '@candy-mountain/platform-daemon'
import { templateNotes } from './schema'
import type { TemplateNote } from './wire'

export const NOTE_CREATED_EVENT = 'template.note.created'

export function listNotes(db: Db, workspaceId: string): TemplateNote[] {
  return db.select().from(templateNotes).where(eq(templateNotes.workspaceId, workspaceId)).orderBy(asc(templateNotes.createdAt)).all()
}

export function hasNotes(db: Db, workspaceId: string): boolean {
  return db.select({ id: templateNotes.id }).from(templateNotes).where(eq(templateNotes.workspaceId, workspaceId)).limit(1).get() !== undefined
}

export function createNote(db: Db, workspace: Pick<Workspace, 'id' | 'slug'>, text: string, scopeUrlPrefix: string): TemplateNote {
  const note: TemplateNote = { id: randomUUID(), workspaceId: workspace.id, text, createdAt: new Date().toISOString() }
  db.insert(templateNotes).values(note).run()
  // Written through the platform rather than into activity_events, so the type and payload size are checked.
  appendActivityEvent(db, { workspaceId: workspace.id, type: NOTE_CREATED_EVENT, title: `Note added: ${text}`, link: workspaceViewRoute(scopeUrlPrefix, workspace.slug, 'template'), payload: { noteId: note.id } })
  return note
}
