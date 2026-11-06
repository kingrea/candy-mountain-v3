import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { AUTH_STRATEGY_PATH, HEALTH_PATH, INFO_PATH, type RegistryResponse, type WorkspaceListResponse, type WorkspaceResponse } from '@candy-mountain/platform-sdk'
import { createTempDataDir, createTestApp, openTestDatabase, platformApp, startTestPlatform, TEST_PRODUCT_CONFIG, type TempDataDir } from './testing'
import { dataPaths } from './data-dir'
import type { Platform } from './platform'

describe('daemon app', () => {
  const database = openTestDatabase()
  afterAll(() => database.close())

  it('answers the health check', async () => {
    const res = await createTestApp({ db: database.db, paths: dataPaths('/unused') }).request(HEALTH_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})

describe('the app over a platform with no product definitions', () => {
  let temp: TempDataDir
  let platform: Platform

  afterEach(async () => {
    await platform?.close()
    temp?.cleanup()
  })

  it('serves the platform routes over its own tables', async () => {
    temp = createTempDataDir()
    platform = startTestPlatform(temp.root)
    const app = platformApp(platform)

    expect(platform.capabilities.list().map(c => c.id)).toEqual([])
    expect(platform.migrationSets.map(set => set.id)).toEqual(['platform'])

    expect(await (await app.request(HEALTH_PATH)).json()).toEqual({ status: 'ok' })
    expect(await (await app.request(AUTH_STRATEGY_PATH)).json()).toEqual({ strategy: 'development' })
    expect(await (await app.request(INFO_PATH)).json()).toMatchObject({ productName: TEST_PRODUCT_CONFIG.name, scopeLabel: TEST_PRODUCT_CONFIG.scope.label, dataDir: platform.paths.root })

    const created = await app.request('/workspaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alpha' }) })
    expect(created.status).toBe(201)
    expect((await created.json() as WorkspaceResponse).workspace).toMatchObject({ slug: 'alpha', name: 'Alpha' })
    expect((await (await app.request('/workspaces')).json() as WorkspaceListResponse).workspaces.map(w => w.slug)).toEqual(['alpha'])

    const registry = await app.request('/workspaces/alpha/registry')
    expect(registry.status).toBe(200)
    expect(await registry.json() as RegistryResponse).toMatchObject({ capabilities: [], agents: [], degraded: [] })
  })
})
