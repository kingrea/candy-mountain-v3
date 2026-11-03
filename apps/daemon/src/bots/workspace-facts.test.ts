import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/platform-sdk'
import { createWorkspaceFactRegistry, type PlatformDatabase } from '@candy-mountain/platform-daemon'
import { afterEach, describe, expect, it } from 'vitest'
import { REPOSITORY_WORKSPACE_FACTS } from '../repository/definition'
import { createWorkspaceWithRepository } from '../repository/test-support'
import { openTestDatabase } from '../testing'
import { BOT_WORKSPACE_FACTS } from './definition'
import { bots } from './schema'

const label = CANDY_MOUNTAIN_PRODUCT.scope.label

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
