import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { createTempDataDir, platformApp, startTestPlatform, testProduct, type Platform, type TempDataDir } from '@candy-mountain/platform-daemon'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { uptimeTestProduct } from './test-support'
import { MONITOR_SOURCES_PATH } from './wire'

describe('the uptime definition', () => {
  const open: Platform[] = []
  const temps: TempDataDir[] = []

  afterEach(async () => {
    await Promise.all(open.splice(0).map(p => p.close()))
    temps.splice(0).forEach(t => t.cleanup())
  })

  function start(product: ReturnType<typeof testProduct>) {
    const dir = createTempDataDir()
    temps.push(dir)
    const platform = startTestPlatform(dir.root, { product })
    open.push(platform)
    return { platform, app: platformApp(platform) }
  }

  it('serves its routes with its scheduler running', async () => {
    const { platform, app } = start(uptimeTestProduct())

    expect(platform.migrationSets.map(set => set.id)).toContain('uptime')
    expect(existsSync(join(platform.paths.run, 'uptime-scheduler.owner'))).toBe(true)
    expect((await app.request(MONITOR_SOURCES_PATH)).status).toBe(200)
    const monitors = await app.request(`${WORKSPACES_PATH}/nope/monitors`)
    expect(monitors.status).toBe(404)
    expect(((await monitors.json()) as ApiErrorBody).error.code).toBe('not_found')
  })

  it('leaves no route, scheduler or table behind when a product does not list it', async () => {
    const { platform, app } = start(testProduct())

    expect(existsSync(join(platform.paths.run, 'uptime-scheduler.owner'))).toBe(false)
    const sources = await app.request(MONITOR_SOURCES_PATH)
    expect(sources.status).toBe(404)
    expect(await sources.text()).toBe('404 Not Found')
    expect((await app.request(`${WORKSPACES_PATH}/nope/monitors`)).status).toBe(404)
    expect((await app.request(WORKSPACES_PATH)).status).toBe(200)
    const tables = platform.db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`).map(row => row.name)
    expect(tables.filter(name => name.startsWith('uptime'))).toEqual([])
  })
})
