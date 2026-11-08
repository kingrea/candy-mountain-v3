import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createWorkspaceFactRegistry, type PlatformDatabase } from '@candy-mountain/platform-daemon'
import { TEST_PRODUCT_CONFIG } from '@candy-mountain/platform-daemon/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkspaceWithRepository, REPOSITORY_WORKSPACE_FACTS } from '@candy-mountain/plugin-repository'
import { openBotsDatabase } from '../test-support'
import { BOT_WORKSPACE_FACTS } from '../definition'
import { bots } from '../schema'

const label = TEST_PRODUCT_CONFIG.scope.label

describe('the facts bots and repository declare', () => {
  let database: PlatformDatabase
  let checkout: string
  afterEach(() => {
    database?.close()
    if (checkout) rmSync(checkout, { recursive: true, force: true })
  })

  it('answers the repository facts from the stored verification and hasBots from the bots table, worded as before', async () => {
    database = openBotsDatabase()
    checkout = mkdtempSync(join(tmpdir(), 'cap-bots-facts-'))
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
      'The workspace has no .beads directory.',
      'The workspace is not a git repository.',
      'The workspace has no git remote.',
      'The workspace has no bots yet; add one on the Bots page.',
    ])
  })
})
