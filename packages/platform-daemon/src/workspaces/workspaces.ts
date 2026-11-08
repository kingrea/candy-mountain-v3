import { randomUUID } from 'node:crypto'
import { WORKSPACE_COLOR_PALETTE, type CreateWorkspaceRequest, type ScopeLabel, type Workspace, type UpdateWorkspaceRequest } from '@candy-mountain/platform-sdk'
import { asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import { workspaces } from '../db/schema'
import { deleteNotificationState } from '../notifications/rules'
import { WorkspaceError } from './errors'
import { findOrganisationById } from './organisations'
import { isUniqueViolation, resolveSlug } from './slugs'
import { checkColor, checkName, checkSlug } from './validation'

type WorkspaceRow = typeof workspaces.$inferSelect

/** The platform's own word, for callers without a product's `scope.label`. */
export const WORKSPACE_LABEL: Readonly<ScopeLabel> = { singular: 'workspace', plural: 'workspaces', singularTitle: 'Workspace', pluralTitle: 'Workspaces' }

export interface ListWorkspacesOptions {
  includeArchived?: boolean
}

export type WorkspaceArchiveListener = (db: Db, workspace: Workspace) => void

const archiveListeners = new Set<WorkspaceArchiveListener>()

/** Called after a workspace is archived or unarchived, with the database it was written to. */
export function onWorkspaceArchiveChange(listener: WorkspaceArchiveListener): () => void {
  archiveListeners.add(listener)
  return () => archiveListeners.delete(listener)
}

function emitArchiveChange(db: Db, workspace: Workspace): Workspace {
  for (const listener of archiveListeners) {
    try {
      listener(db, workspace)
    }
    catch (error) {
      console.error('Workspace archive listener failed', error)
    }
  }
  return workspace
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    color: row.color,
    organisationId: row.organisationId,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function slugTaken(db: Db, slug: string): boolean {
  return db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).get() !== undefined
}

function rethrowSlugConflict(error: unknown, slug: string, label: ScopeLabel): never {
  if (isUniqueViolation(error)) throw new WorkspaceError('slug_taken', `${label.singularTitle} slug "${slug}" is already in use`)
  throw error
}

function checkOrganisation(db: Db, organisationId: string | null | undefined): string | null {
  if (organisationId == null) return null
  if (!findOrganisationById(db, organisationId)) {
    throw new WorkspaceError('organisation_not_found', `No organisation with id "${organisationId}"`)
  }
  return organisationId
}

function defaultColor(slug: string): string {
  let hash = 0
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return WORKSPACE_COLOR_PALETTE[hash % WORKSPACE_COLOR_PALETTE.length]!
}

export function listWorkspaces(db: Db, options: ListWorkspacesOptions = {}): Workspace[] {
  return db
    .select()
    .from(workspaces)
    .where(options.includeArchived ? undefined : isNull(workspaces.archivedAt))
    .orderBy(asc(workspaces.name), asc(workspaces.slug))
    .all()
    .map(toWorkspace)
}

export function findWorkspaceBySlug(db: Db, slug: string): Workspace | null {
  const row = db.select().from(workspaces).where(eq(workspaces.slug, slug)).get()
  return row ? toWorkspace(row) : null
}

export function findWorkspaceById(db: Db, id: string): Workspace | null {
  const row = db.select().from(workspaces).where(eq(workspaces.id, id)).get()
  return row ? toWorkspace(row) : null
}

export function getWorkspaceBySlug(db: Db, slug: string, label: ScopeLabel = WORKSPACE_LABEL): Workspace {
  const workspace = findWorkspaceBySlug(db, slug)
  if (!workspace) throw new WorkspaceError('not_found', `No ${label.singular} with slug "${slug}"`)
  return workspace
}

export function createWorkspace(db: Db, input: CreateWorkspaceRequest, label: ScopeLabel = WORKSPACE_LABEL): Workspace {
  const name = checkName(input.name)
  const color = input.color === undefined ? undefined : checkColor(input.color)
  const organisationId = checkOrganisation(db, input.organisationId)
  const slug = resolveSlug(input.slug, name, s => slugTaken(db, s), label.singularTitle)
  const now = new Date().toISOString()
  const row: WorkspaceRow = {
    id: randomUUID(),
    slug,
    name,
    color: color ?? defaultColor(slug),
    organisationId,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  try {
    db.insert(workspaces).values(row).run()
  }
  catch (error) {
    rethrowSlugConflict(error, slug, label)
  }
  return toWorkspace(row)
}

export function updateWorkspace(db: Db, slug: string, input: UpdateWorkspaceRequest, label: ScopeLabel = WORKSPACE_LABEL): Workspace {
  const existing = getWorkspaceBySlug(db, slug, label)
  const newSlug = input.slug === undefined ? undefined : checkSlug(input.slug)
  const changes: Partial<WorkspaceRow> = {}
  if (input.name !== undefined) changes.name = checkName(input.name)
  if (input.color !== undefined) changes.color = checkColor(input.color)
  if (input.organisationId !== undefined) changes.organisationId = checkOrganisation(db, input.organisationId)
  if (newSlug !== undefined && newSlug !== existing.slug) {
    if (slugTaken(db, newSlug)) throw new WorkspaceError('slug_taken', `${label.singularTitle} slug "${newSlug}" is already in use`)
    changes.slug = newSlug
  }
  return writeChanges(db, existing.id, changes, label, changes.slug)
}

export function archiveWorkspace(db: Db, slug: string, label: ScopeLabel = WORKSPACE_LABEL): Workspace {
  const existing = getWorkspaceBySlug(db, slug, label)
  if (existing.archivedAt) return existing
  return emitArchiveChange(db, writeChanges(db, existing.id, { archivedAt: new Date().toISOString() }, label))
}

export function unarchiveWorkspace(db: Db, slug: string, label: ScopeLabel = WORKSPACE_LABEL): Workspace {
  const existing = getWorkspaceBySlug(db, slug, label)
  if (!existing.archivedAt) return existing
  return emitArchiveChange(db, writeChanges(db, existing.id, { archivedAt: null }, label))
}

/** Every other row keyed to the workspace goes by its foreign key's cascade. */
export function deleteWorkspace(db: Db, slug: string, label: ScopeLabel = WORKSPACE_LABEL): void {
  const existing = getWorkspaceBySlug(db, slug, label)
  db.delete(workspaces).where(eq(workspaces.id, existing.id)).run()
  deleteNotificationState(db, existing.id)
}

function writeChanges(db: Db, id: string, changes: Partial<WorkspaceRow>, label: ScopeLabel, newSlug?: string): Workspace {
  try {
    db.update(workspaces).set({ ...changes, updatedAt: new Date().toISOString() }).where(eq(workspaces.id, id)).run()
  }
  catch (error) {
    rethrowSlugConflict(error, newSlug ?? '', label)
  }
  const updated = findWorkspaceById(db, id)
  if (!updated) throw new WorkspaceError('not_found', `${label.singularTitle} ${id} was deleted during the update`)
  return updated
}
