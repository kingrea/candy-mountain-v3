import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedAuth } from '../auth/seed'
import { openDatabase, type PlatformDatabase } from '../db'

export function openTestDatabase({ seed = true }: { seed?: boolean } = {}): PlatformDatabase {
  const database = openDatabase(':memory:')
  if (seed) seedAuth(database.db)
  return database
}

export interface TempDataDir {
  root: string
  cleanup(): void
}

export function createTempDataDir(): TempDataDir {
  const parent = mkdtempSync(join(tmpdir(), 'candy-mountain-test-'))
  return { root: join(parent, 'data'), cleanup: () => rmSync(parent, { recursive: true, force: true }) }
}
