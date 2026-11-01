import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMastra } from './mastra'
import { startTestPlatform } from './testing/platform'
import type { Platform } from './platform'
import { createTempDataDir, type TempDataDir } from './testing'

let dir: TempDataDir
let platform: Platform

beforeEach(() => {
  dir = createTempDataDir()
  platform = startTestPlatform(dir.root)
})

afterEach(() => {
  platform.close()
  dir.cleanup()
  vi.unstubAllGlobals()
})

it('initialises with no agents, no credentials and no network', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access attempted')
  })
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('ANTHROPIC_API_KEY', '')

  const { mastra, close } = await createMastra(platform.paths)
  expect(Object.keys(mastra.listAgents())).toEqual([])
  expect(Object.keys(mastra.listWorkflows())).toEqual([])
  await close()
})

it('creates its tables beside the Drizzle ones without disturbing them', async () => {
  const { close } = await createMastra(platform.paths)
  await close()

  const sqlite = new Database(platform.paths.database, { readonly: true })
  const tables = sqlite
    .prepare("select name from sqlite_master where type = 'table'")
    .all()
    .map(row => (row as { name: string }).name)
  sqlite.close()

  expect(tables).toContain('platform_meta')
  expect(tables).toContain('__drizzle_migrations')
  expect(tables.some(name => name.startsWith('mastra_'))).toBe(true)
})
