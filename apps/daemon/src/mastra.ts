import { Mastra } from '@mastra/core'
import type { Agent } from '@mastra/core/agent'
import { LibSQLStore } from '@mastra/libsql'
import type { DataPaths } from './data-dir'

export interface PlatformMastra {
  mastra: Mastra
  storage: LibSQLStore
  close(): Promise<void>
}

export interface MastraOptions {
  /** Agents keyed by their registry agent id; they get the same store for memory, so it is handed over here. */
  agents?: (storage: LibSQLStore) => Record<string, Agent>
}

// Mastra owns its mastra_* tables in the shared file; never put them in Drizzle migrations.
export async function createMastra(paths: Pick<DataPaths, 'database'>, options: MastraOptions = {}): Promise<PlatformMastra> {
  const storage = new LibSQLStore({ id: 'platform', url: `file:${paths.database}` })
  const mastra = new Mastra({ storage, logger: false, agents: options.agents?.(storage) ?? {} })
  await storage.init()
  return { mastra, storage, close: () => mastra.shutdown() }
}
