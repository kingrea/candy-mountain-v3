import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACES_PATH, REPOSITORY_CAPABILITY_ID, repositoryPath, type RepositoryResponse } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityDefinitionError, type Platform } from '@candy-mountain/platform-daemon'
import { createTempDataDir, type TempDataDir } from '../testing'
import { platformApp, startTestPlatform, withoutCapabilities } from '../testing/platform'
import { REPOSITORY_PATHS } from './definition'
import { findRepository } from './service'
import { createWorkspaceWithRepository } from './test-support'

describe('the repository definition', () => {
  let temp: TempDataDir | undefined
  let platform: Platform | undefined

  afterEach(async () => {
    await platform?.close()
    platform = undefined
    temp?.cleanup()
    temp = undefined
  })

  it.each(['issues', 'chat-claude-code', 'bots'])('is required by %s: a product without it refuses to boot, naming the dependency', (dependent) => {
    temp = createTempDataDir()
    const options = withoutCapabilities(REPOSITORY_CAPABILITY_ID)
    expect(() => startTestPlatform(temp!.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp!.root, options)).toThrow(new RegExp(`Capability '(issues|chat-claude-code|bots)' depends on 'repository', which is not in the definition list.`))
    expect(options.capabilities.some(c => c.id === dependent)).toBe(true)
    expect(existsSync(temp.root)).toBe(false)
  })

  it('is service-only, serves the repository routes and answers checkouts through its service', async () => {
    temp = createTempDataDir()
    platform = startTestPlatform(temp.root)
    expect(platform.capabilities.has(REPOSITORY_CAPABILITY_ID)).toBe(false)
    expect(platform.capabilities.definitions().some(d => d.id === REPOSITORY_CAPABILITY_ID)).toBe(true)

    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-repository-'))
    try {
      const workspace = await createWorkspaceWithRepository(platform.db, { name: 'Alpha', slug: 'alpha', path: checkout })
      expect(platform.runtime.service(REPOSITORY_PATHS)?.get(workspace.id)).toBe(checkout)

      const app = platformApp(platform)
      const read = await app.request(repositoryPath('alpha'))
      expect(read.status).toBe(200)
      expect((await read.json() as RepositoryResponse).repository).toMatchObject({ workspaceId: workspace.id, source: { path: checkout } })

      expect((await app.request(`${WORKSPACES_PATH}/alpha`, { method: 'DELETE' })).status).toBe(204)
      expect(findRepository(platform.db, workspace.id)).toBeNull()
      expect(platform.runtime.service(REPOSITORY_PATHS)?.find(workspace.id)).toBeNull()
    }
    finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })
})
