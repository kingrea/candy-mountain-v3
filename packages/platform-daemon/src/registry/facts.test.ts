import type { AnyCapabilityManifest } from '@candy-mountain/platform-sdk'
import { describe, expect, it } from 'vitest'
import { fixtureCapability, fixtureDefinition } from '../capabilities/fixtures'
import { TEST_PRODUCT_CONFIG } from '../testing'
import { assertRequiredWorkspaceFacts, createWorkspaceFactRegistry, declaredWorkspaceFacts, WorkspaceFactError, type WorkspaceFactDeclaration } from './facts'

const label = TEST_PRODUCT_CONFIG.scope.label
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
    expect(registry.messages().hasCi!(label)).toBe('The workspace has no CI.')
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
