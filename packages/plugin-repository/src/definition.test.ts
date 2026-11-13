import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACES_PATH } from '@crab-shack/platform-sdk'
import { REPOSITORY_CAPABILITY_ID, repositoryPath, type RepositoryResponse } from './wire'
import { afterEach, describe, expect, it } from 'vitest'
import { defineCapabilityDefinition } from '@crab-shack/platform-sdk/daemon'
import { CapabilityDefinitionError } from '@crab-shack/platform-daemon'
import { createTempDataDir, startTestPlatform, testKit, type TempDataDir, type TestKit } from '@crab-shack/platform-daemon/testing'
import { REPOSITORY_PATHS, repositoryDefinition } from './definition'
import { findRepository, setRepository } from './service'

describe('the repository definition', () => {
  let temp: TempDataDir | undefined
  let kit: TestKit | undefined

  afterEach(async () => {
    await kit?.close()
    kit = undefined
    temp?.cleanup()
    temp = undefined
  })

  it('is required by its dependents: a product without it refuses to boot, naming the dependency', () => {
    temp = createTempDataDir()
    const dependent = defineCapabilityDefinition({ id: 'dependent', sdkMajor: 0, dependsOn: [REPOSITORY_CAPABILITY_ID], start: () => ({}) })
    expect(() => startTestPlatform(temp!.root, { capabilities: [dependent] })).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp!.root, { capabilities: [dependent] })).toThrow('Capability \'dependent\' depends on \'repository\', which is not in the definition list.')
    expect(existsSync(temp.root)).toBe(false)
  })

  it('is service-only, serves the repository routes and answers checkouts through its service', async () => {
    kit = testKit({ capabilities: [repositoryDefinition()] })
    const { platform } = kit
    expect(platform.capabilities.has(REPOSITORY_CAPABILITY_ID)).toBe(false)
    expect(platform.capabilities.definitions().some(d => d.id === REPOSITORY_CAPABILITY_ID)).toBe(true)

    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-repository-'))
    try {
      const workspace = kit.workspace({ name: 'Alpha', slug: 'alpha' })
      await setRepository(kit.db, workspace.id, { kind: 'local-path', path: checkout })
      expect(platform.runtime.service(REPOSITORY_PATHS)?.get(workspace.id)).toBe(checkout)

      const read = await kit.admin.request(repositoryPath('alpha'))
      expect(read.status).toBe(200)
      expect((await read.json() as RepositoryResponse).repository).toMatchObject({ workspaceId: workspace.id, source: { path: checkout } })

      expect((await kit.admin.request(`${WORKSPACES_PATH}/alpha`, { method: 'DELETE' })).status).toBe(204)
      expect(findRepository(platform.db, workspace.id)).toBeNull()
      expect(platform.runtime.service(REPOSITORY_PATHS)?.find(workspace.id)).toBeNull()
    }
    finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })
})
