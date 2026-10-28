import { randomUUID } from 'node:crypto'
import type { CreateOrganisationRequest, Organisation, UpdateOrganisationRequest } from '@candy-mountain/shared'
import { asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { organisations, projects } from '../db/schema'
import { ProjectError } from './errors'
import { isUniqueViolation, resolveSlug } from './slugs'
import { checkName, checkSlug } from './validation'

type OrganisationRow = typeof organisations.$inferSelect

function toOrganisation(row: OrganisationRow): Organisation {
  return { id: row.id, slug: row.slug, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

function slugTaken(db: Db, slug: string): boolean {
  return db.select({ id: organisations.id }).from(organisations).where(eq(organisations.slug, slug)).get() !== undefined
}

function rethrowSlugConflict(error: unknown, slug: string): never {
  if (isUniqueViolation(error)) throw new ProjectError('slug_taken', `Organisation slug "${slug}" is already in use`)
  throw error
}

export function listOrganisations(db: Db): Organisation[] {
  return db.select().from(organisations).orderBy(asc(organisations.name), asc(organisations.slug)).all().map(toOrganisation)
}

export function findOrganisationBySlug(db: Db, slug: string): Organisation | null {
  const row = db.select().from(organisations).where(eq(organisations.slug, slug)).get()
  return row ? toOrganisation(row) : null
}

export function findOrganisationById(db: Db, id: string): Organisation | null {
  const row = db.select().from(organisations).where(eq(organisations.id, id)).get()
  return row ? toOrganisation(row) : null
}

export function getOrganisationBySlug(db: Db, slug: string): Organisation {
  const organisation = findOrganisationBySlug(db, slug)
  if (!organisation) throw new ProjectError('not_found', `No organisation with slug "${slug}"`)
  return organisation
}

export function createOrganisation(db: Db, input: CreateOrganisationRequest): Organisation {
  const name = checkName(input.name)
  const slug = resolveSlug(input.slug, name, s => slugTaken(db, s), 'Organisation')
  const now = new Date().toISOString()
  const row: OrganisationRow = { id: randomUUID(), slug, name, createdAt: now, updatedAt: now }
  try {
    db.insert(organisations).values(row).run()
  }
  catch (error) {
    rethrowSlugConflict(error, slug)
  }
  return toOrganisation(row)
}

export function updateOrganisation(db: Db, slug: string, input: UpdateOrganisationRequest): Organisation {
  const existing = getOrganisationBySlug(db, slug)
  const changes: Partial<OrganisationRow> = { updatedAt: new Date().toISOString() }
  if (input.name !== undefined) changes.name = checkName(input.name)
  if (input.slug !== undefined && input.slug !== existing.slug) {
    changes.slug = checkSlug(input.slug)
    if (slugTaken(db, changes.slug)) throw new ProjectError('slug_taken', `Organisation slug "${changes.slug}" is already in use`)
  }
  try {
    db.update(organisations).set(changes).where(eq(organisations.id, existing.id)).run()
  }
  catch (error) {
    rethrowSlugConflict(error, changes.slug ?? existing.slug)
  }
  return findOrganisationById(db, existing.id)!
}

export function deleteOrganisation(db: Db, slug: string): void {
  const existing = getOrganisationBySlug(db, slug)
  db.transaction((tx) => {
    tx.update(projects).set({ organisationId: null }).where(eq(projects.organisationId, existing.id)).run()
    tx.delete(organisations).where(eq(organisations.id, existing.id)).run()
  })
}
