import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CANDY_MOUNTAIN_PRODUCT, type AnyCapabilityManifest } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { bots } from '../bots/schema'
import { BOT_WORKSPACE_FACTS } from '../bots/definition'
import { fixtureCapability, fixtureDefinition } from '../capabilities/fixtures'
import type { PlatformDatabase } from '../db'
import { REPOSITORY_WORKSPACE_FACTS } from '../repository/definition'
import { createWorkspaceWithRepository } from '../repository/test-support'
import { openTestDatabase } from '../testing'
import { assertRequiredWorkspaceFacts, createWorkspaceFactRegistry, declaredWorkspaceFacts, WorkspaceFactError, type WorkspaceFactDeclaration } from './facts'

const label = CANDY_MOUNTAIN_PRODUCT.scope.label
const fact = (id: string, holds = true): WorkspaceFactDeclaration => ({ id, compute: () => holds, message: scope => `The ${scope.singular} lacks ${id}.` })

const rejects = (declarations: WorkspaceFactDeclaration[], message: string) => {
  expect(() => createWorkspaceFactRegistry(declarations)).toThrow(WorkspaceFactError)
  expect(() => createWorkspaceFactRegistry(declarations)).toThrow(message)
}

describe('createWorkspaceFactRegistry', () => {
  it('lists the declared facts in order, computes each through its declaration and words it with the scope label', () => {
    const asked: string[] = []
    const registry = createWorkspaceFactRegistry([
      { id: 'hasDocs', compute: (_db, workspace) => (asked.push(workspace.id), true), message: scope => `The ${scope.singular} has no docs.` },
      { id: 'hasCi', compute: () => false, message: scope => `The ${scope.singular} has no CI.` },
    ])
    expect(registry.list()).toEqual(['hasDocs', 'hasCi'])
    expect(registry.has('hasDocs')).toBe(true)
    expect(registry.has('hasBeads')).toBe(false)
    expect(registry.compute({} as never, { id: 'w1' })).toEqual({ hasDocs: true, hasCi: false })
    expect(asked).toEqual(['w1'])
    expect(registry.messages().hasCi!(label)).toBe('The project has no CI.')
  })

  it('refuses malformed, duplicate or incomplete declarations', () => {
    rejects([fact('Has Docs')], "Invalid workspace fact id(s) 'Has Docs'; fact ids are camelCase words such as 'hasBeads'.")
    rejects([fact('hasDocs'), fact('hasDocs')], "Duplicate workspace fact id(s): 'hasDocs'.")
    rejects([{ ...fact('hasDocs'), compute: true as never }], "Workspace fact(s) 'hasDocs': compute must be a function.")
    rejects([{ ...fact('hasDocs'), message: 'no' as never }], "Workspace fact(s) 'hasDocs': message must be a function.")
  })

  it('gathers declarations from definitions in list order', () => {
    const definitions = [fixtureDefinition('a', { workspaceFacts: [fact('hasA')] }), fixtureDefinition('b'), fixtureDefinition('c', { workspaceFacts: [fact('hasC'), fact('hasD')] })]
    expect(declaredWorkspaceFacts(definitions).map(d => d.id)).toEqual(['hasA', 'hasC', 'hasD'])
  })
})

describe('assertRequiredWorkspaceFacts', () => {
  const team: AnyCapabilityManifest = { ...fixtureCapability('team'), requiresWorkspaceFacts: ['hasBots'] }

  it('accepts a manifest whose facts are declared and refuses one naming a fact nothing declares', () => {
    expect(() => assertRequiredWorkspaceFacts([team], createWorkspaceFactRegistry([fact('hasBots')]))).not.toThrow()
    expect(() => assertRequiredWorkspaceFacts([team], createWorkspaceFactRegistry([]))).toThrow(WorkspaceFactError)
    expect(() => assertRequiredWorkspaceFacts([team], createWorkspaceFactRegistry([]))).toThrow("Capability 'team' requires workspace fact 'hasBots', which no definition declares.")
  })
})

describe('the facts the product declares', () => {
  let database: PlatformDatabase
  let checkout: string
  afterEach(() => {
    database?.close()
    if (checkout) rmSync(checkout, { recursive: true, force: true })
  })

  it('answers the repository facts from the stored verification and hasBots from the bots table, worded as before', async () => {
    database = openTestDatabase()
    checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-facts-'))
    const registry = createWorkspaceFactRegistry([...REPOSITORY_WORKSPACE_FACTS, ...BOT_WORKSPACE_FACTS])
    expect(registry.list()).toEqual(['hasBeads', 'isGitRepo', 'hasRemote', 'hasBots'])

    const workspace = await createWorkspaceWithRepository(database.db, { name: 'Alpha', slug: 'alpha', path: checkout })
    expect(registry.compute(database.db, workspace)).toEqual({ hasBeads: false, isGitRepo: false, hasRemote: false, hasBots: false })
    expect(registry.compute(database.db, { id: 'no-such-workspace' })).toEqual({ hasBeads: false, isGitRepo: false, hasRemote: false, hasBots: false })

    const now = new Date().toISOString()
    database.db.insert(bots).values({ id: randomUUID(), projectId: workspace.id, name: 'Candy', family: 'claude-code', writeScope: 'read-only', answersIn: { anywhere: true }, createdAt: now, updatedAt: now }).run()
    expect(registry.compute(database.db, workspace).hasBots).toBe(true)

    const messages = registry.messages()
    expect(Object.keys(messages).map(id => messages[id]!(label))).toEqual([
      'The project has no .beads directory.',
      'The project is not a git repository.',
      'The project has no git remote.',
      'The project has no bots yet; add one on the Bots page.',
    ])
  })
})
