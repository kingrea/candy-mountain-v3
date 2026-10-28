import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DataPaths } from '../../data-dir'

const INSTANCE_ID = /^[A-Za-z0-9-]+$/

/** One private Codex home per plugin instance, so each project can log in to a different account. */
export function codexHome(paths: Pick<DataPaths, 'agentHomes'>, instanceId: string): string {
  if (!INSTANCE_ID.test(instanceId)) throw new Error(`Invalid plugin instance id "${instanceId}"`)
  return join(paths.agentHomes, 'codex', instanceId)
}

export function ensureCodexHome(home: string): string {
  mkdirSync(home, { recursive: true, mode: 0o700 })
  chmodSync(join(home, '..'), 0o700)
  chmodSync(home, 0o700)
  return home
}

/** Returns false when there was no home to delete. */
export function removeCodexHome(paths: Pick<DataPaths, 'agentHomes'>, instanceId: string): boolean {
  const home = codexHome(paths, instanceId)
  if (!existsSync(home)) return false
  rmSync(home, { recursive: true, force: true })
  return true
}
