import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlatformDatabase } from '../db'
import { openTestDatabase } from '../testing'
import { ProjectError } from './errors'
import { createOrganisation, deleteOrganisation, listOrganisations, updateOrganisation } from './organisations'
import {
  archiveProject,
  createProject,
  deleteProject,
  findProjectBySlug,
  getProjectBySlug,
  listProjects,
  reverifyProject,
  unarchiveProject,
  updateProject,
} from './projects'
import { createTempRepos } from './test-repos'

const repos = createTempRepos()
afterAll(() => repos.cleanup())

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase()
})
afterEach(() => database.close())

function localPath(path: string) {
  return { kind: 'local-path' as const, path }
}

async function expectProjectError(promise: Promise<unknown> | (() => unknown), code: string) {
  const run = typeof promise === 'function' ? Promise.resolve().then(promise) : promise
  await expect(run).rejects.toSatisfy(error => error instanceof ProjectError && error.code === code)
}

describe('projects', () => {
  it('rejects a path that does not exist', async () => {
    const missing = join(repos.root, 'missing')
    await expect(createProject(database.db, { name: 'Ghost', source: localPath(missing) })).rejects.toThrow(
      `Project path does not exist or is not a directory: ${missing}`,
    )
    expect(listProjects(database.db)).toEqual([])
  })

  it('records beads and remote facts on create', async () => {
    const path = repos.dir('candy', { beads: true, git: true, remotes: { origin: 'git@github.com:jack/candy.git' } })
    const project = await createProject(database.db, { name: 'Candy Mountain', source: localPath(`${path}/`) })
    expect(project).toMatchObject({
      slug: 'candy-mountain',
      archived: false,
      organisationId: null,
      source: { kind: 'local-path', path },
      verification: { pathExists: true, hasBeads: true, isGitRepo: true, hasRemote: true, remoteUrl: 'git@github.com:jack/candy.git' },
    })
    expect(project.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(getProjectBySlug(database.db, 'candy-mountain')).toEqual(project)
  })

  it('suffixes derived slugs and rejects taken explicit slugs', async () => {
    const path = repos.dir('slugs')
    const first = await createProject(database.db, { name: 'Same Name', source: localPath(path) })
    const second = await createProject(database.db, { name: 'Same Name', source: localPath(path) })
    expect([first.slug, second.slug]).toEqual(['same-name', 'same-name-2'])

    await expectProjectError(createProject(database.db, { name: 'Other', slug: 'same-name', source: localPath(path) }), 'slug_taken')
    await expectProjectError(updateProject(database.db, 'same-name-2', { slug: 'same-name' }), 'slug_taken')
    await expectProjectError(createProject(database.db, { name: 'Bad', slug: 'Not Safe', source: localPath(path) }), 'invalid_request')
    await expectProjectError(createProject(database.db, { name: '!!!', source: localPath(path) }), 'invalid_request')
  })

  it('keeps the slug when the name changes and re-verifies on update', async () => {
    const path = repos.dir('rename')
    await createProject(database.db, { name: 'Before', source: localPath(path) })
    const moved = repos.dir('rename-target', { beads: true })
    const updated = await updateProject(database.db, 'before', { name: 'After', source: localPath(moved), color: '#ABCDEF' })
    expect(updated).toMatchObject({ slug: 'before', name: 'After', color: '#abcdef', verification: { hasBeads: true } })

    await expectProjectError(updateProject(database.db, 'before', { source: localPath(join(repos.root, 'gone')) }), 'path_not_found')
  })

  it('re-runs verification on demand without failing when the path has gone', async () => {
    const path = repos.dir('reverify')
    await createProject(database.db, { name: 'Reverify', source: localPath(path) })
    repos.dir('reverify', { beads: true })
    expect((await reverifyProject(database.db, 'reverify')).verification.hasBeads).toBe(true)

    rmSync(path, { recursive: true })
    expect((await reverifyProject(database.db, 'reverify')).verification).toMatchObject({ pathExists: false, hasBeads: false })
  })

  it('excludes archived projects from the default list', async () => {
    const path = repos.dir('archive')
    await createProject(database.db, { name: 'Active', source: localPath(path) })
    await createProject(database.db, { name: 'Old', source: localPath(path) })
    const archived = archiveProject(database.db, 'old')
    expect(archived.archived).toBe(true)
    expect(archived.archivedAt).not.toBeNull()

    expect(listProjects(database.db).map(p => p.slug)).toEqual(['active'])
    expect(listProjects(database.db, { includeArchived: true }).map(p => p.slug)).toEqual(['active', 'old'])

    expect(unarchiveProject(database.db, 'old').archived).toBe(false)
    expect(listProjects(database.db).map(p => p.slug)).toEqual(['active', 'old'])
  })

  it('deletes a project', async () => {
    await createProject(database.db, { name: 'Doomed', source: localPath(repos.dir('doomed')) })
    deleteProject(database.db, 'doomed')
    expect(findProjectBySlug(database.db, 'doomed')).toBeNull()
    await expectProjectError(() => deleteProject(database.db, 'doomed'), 'not_found')
  })

  it('rejects an unknown organisation', async () => {
    await expectProjectError(
      createProject(database.db, { name: 'Orphan', organisationId: 'nope', source: localPath(repos.dir('orphan')) }),
      'organisation_not_found',
    )
  })
})

describe('organisations', () => {
  it('enforces unique slugs', async () => {
    const org = createOrganisation(database.db, { name: 'New Orange' })
    expect(org.slug).toBe('new-orange')
    expect(createOrganisation(database.db, { name: 'New Orange' }).slug).toBe('new-orange-2')
    await expectProjectError(() => createOrganisation(database.db, { name: 'X', slug: 'new-orange' }), 'slug_taken')
    await expectProjectError(() => updateOrganisation(database.db, 'new-orange-2', { slug: 'new-orange' }), 'slug_taken')
    expect(updateOrganisation(database.db, 'new-orange-2', { name: 'Old Orange', slug: 'old-orange' })).toMatchObject({
      slug: 'old-orange', name: 'Old Orange',
    })
  })

  it('ungroups projects when deleted', async () => {
    const org = createOrganisation(database.db, { name: 'Group' })
    const path = repos.dir('grouped')
    await createProject(database.db, { name: 'Grouped', organisationId: org.id, source: localPath(path) })
    deleteOrganisation(database.db, 'group')

    expect(listOrganisations(database.db)).toEqual([])
    expect(getProjectBySlug(database.db, 'grouped').organisationId).toBeNull()
  })
})
