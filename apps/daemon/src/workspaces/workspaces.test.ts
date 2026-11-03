import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlatformDatabase } from '../db'
import { openTestDatabase } from '../testing'
import { WorkspaceError } from './errors'
import { createOrganisation, deleteOrganisation, listOrganisations, updateOrganisation } from './organisations'
import {
  archiveWorkspace,
  createWorkspace,
  deleteWorkspace,
  findWorkspaceBySlug,
  getWorkspaceBySlug,
  listWorkspaces,
  unarchiveWorkspace,
  updateWorkspace,
} from './workspaces'

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase()
})
afterEach(() => database.close())

function expectWorkspaceError(run: () => unknown, code: string) {
  expect(run).toThrow(WorkspaceError)
  expect(run).toThrow(expect.objectContaining({ code }))
}

describe('workspaces', () => {
  it('creates a workspace with nothing but its identity', () => {
    const workspace = createWorkspace(database.db, { name: 'Candy Mountain' })
    expect(workspace).toMatchObject({ slug: 'candy-mountain', name: 'Candy Mountain', archived: false, archivedAt: null, organisationId: null })
    expect(workspace.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(Object.keys(workspace).sort()).toEqual(['archived', 'archivedAt', 'color', 'createdAt', 'id', 'name', 'organisationId', 'slug', 'updatedAt'])
    expect(getWorkspaceBySlug(database.db, 'candy-mountain')).toEqual(workspace)
  })

  it('suffixes derived slugs and rejects taken explicit slugs', () => {
    const first = createWorkspace(database.db, { name: 'Same Name' })
    const second = createWorkspace(database.db, { name: 'Same Name' })
    expect([first.slug, second.slug]).toEqual(['same-name', 'same-name-2'])

    expectWorkspaceError(() => createWorkspace(database.db, { name: 'Other', slug: 'same-name' }), 'slug_taken')
    expectWorkspaceError(() => updateWorkspace(database.db, 'same-name-2', { slug: 'same-name' }), 'slug_taken')
    expectWorkspaceError(() => createWorkspace(database.db, { name: 'Bad', slug: 'Not Safe' }), 'invalid_request')
    expectWorkspaceError(() => createWorkspace(database.db, { name: '!!!' }), 'invalid_request')
  })

  it('keeps the slug when the name changes', () => {
    createWorkspace(database.db, { name: 'Before' })
    const updated = updateWorkspace(database.db, 'before', { name: 'After', color: '#ABCDEF' })
    expect(updated).toMatchObject({ slug: 'before', name: 'After', color: '#abcdef' })
    expectWorkspaceError(() => updateWorkspace(database.db, 'before', { color: 'red' }), 'invalid_request')
    expectWorkspaceError(() => updateWorkspace(database.db, 'gone', { name: 'X' }), 'not_found')
  })

  it('excludes archived workspaces from the default list', () => {
    createWorkspace(database.db, { name: 'Active' })
    createWorkspace(database.db, { name: 'Old' })
    const archived = archiveWorkspace(database.db, 'old')
    expect(archived.archived).toBe(true)
    expect(archived.archivedAt).not.toBeNull()

    expect(listWorkspaces(database.db).map(p => p.slug)).toEqual(['active'])
    expect(listWorkspaces(database.db, { includeArchived: true }).map(p => p.slug)).toEqual(['active', 'old'])

    expect(unarchiveWorkspace(database.db, 'old').archived).toBe(false)
    expect(listWorkspaces(database.db).map(p => p.slug)).toEqual(['active', 'old'])
  })

  it('deletes a workspace', () => {
    createWorkspace(database.db, { name: 'Doomed' })
    deleteWorkspace(database.db, 'doomed')
    expect(findWorkspaceBySlug(database.db, 'doomed')).toBeNull()
    expectWorkspaceError(() => deleteWorkspace(database.db, 'doomed'), 'not_found')
  })

  it('rejects an unknown organisation', () => {
    expectWorkspaceError(() => createWorkspace(database.db, { name: 'Orphan', organisationId: 'nope' }), 'organisation_not_found')
  })
})

describe('organisations', () => {
  it('enforces unique slugs', () => {
    const org = createOrganisation(database.db, { name: 'New Orange' })
    expect(org.slug).toBe('new-orange')
    expect(createOrganisation(database.db, { name: 'New Orange' }).slug).toBe('new-orange-2')
    expectWorkspaceError(() => createOrganisation(database.db, { name: 'X', slug: 'new-orange' }), 'slug_taken')
    expectWorkspaceError(() => updateOrganisation(database.db, 'new-orange-2', { slug: 'new-orange' }), 'slug_taken')
    expect(updateOrganisation(database.db, 'new-orange-2', { name: 'Old Orange', slug: 'old-orange' })).toMatchObject({
      slug: 'old-orange', name: 'Old Orange',
    })
  })

  it('ungroups workspaces when deleted', () => {
    const org = createOrganisation(database.db, { name: 'Group' })
    createWorkspace(database.db, { name: 'Grouped', organisationId: org.id })
    deleteOrganisation(database.db, 'group')

    expect(listOrganisations(database.db)).toEqual([])
    expect(getWorkspaceBySlug(database.db, 'grouped').organisationId).toBeNull()
  })
})
