import { randomUUID } from 'node:crypto'
import {
  PROJECT_COLOR_PALETTE,
  type CreateProjectRequest,
  type Project,
  type ProjectSource,
  type UpdateProjectRequest,
} from '@candy-mountain/shared'
import { asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../db'
import { projects } from '../db/schema'
import { ProjectError } from './errors'
import { findOrganisationById } from './organisations'
import { isUniqueViolation, resolveSlug } from './slugs'
import { checkColor, checkName, checkSlug } from './validation'
import { normaliseProjectPath, requireExistingDirectory, verifyPath } from './verification'

type ProjectRow = typeof projects.$inferSelect

export interface ListProjectsOptions {
  includeArchived?: boolean
}

export type ProjectArchiveListener = (db: Db, project: Project) => void

const archiveListeners = new Set<ProjectArchiveListener>()

/** Called after a project is archived or unarchived, with the database it was written to. */
export function onProjectArchiveChange(listener: ProjectArchiveListener): () => void {
  archiveListeners.add(listener)
  return () => archiveListeners.delete(listener)
}

function emitArchiveChange(db: Db, project: Project): Project {
  for (const listener of archiveListeners) {
    try {
      listener(db, project)
    }
    catch (error) {
      console.error('Project archive listener failed', error)
    }
  }
  return project
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    color: row.color,
    organisationId: row.organisationId,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt,
    source: row.source,
    verification: row.verification,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function slugTaken(db: Db, slug: string): boolean {
  return db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get() !== undefined
}

function rethrowSlugConflict(error: unknown, slug: string): never {
  if (isUniqueViolation(error)) throw new ProjectError('slug_taken', `Project slug "${slug}" is already in use`)
  throw error
}

function checkOrganisation(db: Db, organisationId: string | null | undefined): string | null {
  if (organisationId == null) return null
  if (!findOrganisationById(db, organisationId)) {
    throw new ProjectError('organisation_not_found', `No organisation with id "${organisationId}"`)
  }
  return organisationId
}

async function prepareSource(source: ProjectSource): Promise<ProjectSource> {
  const path = normaliseProjectPath(source.path)
  await requireExistingDirectory(path)
  return { kind: source.kind, path }
}

function defaultColor(slug: string): string {
  let hash = 0
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PROJECT_COLOR_PALETTE[hash % PROJECT_COLOR_PALETTE.length]!
}

export function sourcePath(source: ProjectSource): string {
  return source.path
}

export function listProjects(db: Db, options: ListProjectsOptions = {}): Project[] {
  return db
    .select()
    .from(projects)
    .where(options.includeArchived ? undefined : isNull(projects.archivedAt))
    .orderBy(asc(projects.name), asc(projects.slug))
    .all()
    .map(toProject)
}

export function findProjectBySlug(db: Db, slug: string): Project | null {
  const row = db.select().from(projects).where(eq(projects.slug, slug)).get()
  return row ? toProject(row) : null
}

export function findProjectById(db: Db, id: string): Project | null {
  const row = db.select().from(projects).where(eq(projects.id, id)).get()
  return row ? toProject(row) : null
}

export function getProjectBySlug(db: Db, slug: string): Project {
  const project = findProjectBySlug(db, slug)
  if (!project) throw new ProjectError('not_found', `No project with slug "${slug}"`)
  return project
}

export async function createProject(db: Db, input: CreateProjectRequest): Promise<Project> {
  const name = checkName(input.name)
  const color = input.color === undefined ? undefined : checkColor(input.color)
  const source = await prepareSource(input.source)
  const verification = await verifyPath(sourcePath(source))

  // Database checks run after the awaits so no other request can interleave between them and the write.
  const organisationId = checkOrganisation(db, input.organisationId)
  const slug = resolveSlug(input.slug, name, s => slugTaken(db, s), 'Project')
  const now = new Date().toISOString()
  const row: ProjectRow = {
    id: randomUUID(),
    slug,
    name,
    color: color ?? defaultColor(slug),
    organisationId,
    archivedAt: null,
    source,
    verification,
    createdAt: now,
    updatedAt: now,
  }
  try {
    db.insert(projects).values(row).run()
  }
  catch (error) {
    rethrowSlugConflict(error, slug)
  }
  return toProject(row)
}

export async function updateProject(db: Db, slug: string, input: UpdateProjectRequest): Promise<Project> {
  const current = getProjectBySlug(db, slug)
  const newSlug = input.slug === undefined ? undefined : checkSlug(input.slug)
  const changes: Partial<ProjectRow> = {}
  if (input.name !== undefined) changes.name = checkName(input.name)
  if (input.color !== undefined) changes.color = checkColor(input.color)
  if (input.source !== undefined) changes.source = await prepareSource(input.source)
  changes.verification = await verifyPath(sourcePath(changes.source ?? current.source))

  const existing = findProjectById(db, current.id)
  if (!existing) throw new ProjectError('not_found', `No project with slug "${slug}"`)
  if (input.organisationId !== undefined) changes.organisationId = checkOrganisation(db, input.organisationId)
  if (newSlug !== undefined && newSlug !== existing.slug) {
    if (slugTaken(db, newSlug)) throw new ProjectError('slug_taken', `Project slug "${newSlug}" is already in use`)
    changes.slug = newSlug
  }
  return writeChanges(db, existing.id, changes, changes.slug)
}

export async function reverifyProject(db: Db, slug: string): Promise<Project> {
  const existing = getProjectBySlug(db, slug)
  const verification = await verifyPath(sourcePath(existing.source))
  return writeChanges(db, existing.id, { verification })
}

export function archiveProject(db: Db, slug: string): Project {
  const existing = getProjectBySlug(db, slug)
  if (existing.archivedAt) return existing
  return emitArchiveChange(db, writeChanges(db, existing.id, { archivedAt: new Date().toISOString() }))
}

export function unarchiveProject(db: Db, slug: string): Project {
  const existing = getProjectBySlug(db, slug)
  if (!existing.archivedAt) return existing
  return emitArchiveChange(db, writeChanges(db, existing.id, { archivedAt: null }))
}

export function deleteProject(db: Db, slug: string): void {
  const existing = getProjectBySlug(db, slug)
  db.delete(projects).where(eq(projects.id, existing.id)).run()
}

function writeChanges(db: Db, id: string, changes: Partial<ProjectRow>, newSlug?: string): Project {
  try {
    db.update(projects).set({ ...changes, updatedAt: new Date().toISOString() }).where(eq(projects.id, id)).run()
  }
  catch (error) {
    rethrowSlugConflict(error, newSlug ?? '')
  }
  const updated = findProjectById(db, id)
  if (!updated) throw new ProjectError('not_found', `Project ${id} was deleted during the update`)
  return updated
}
