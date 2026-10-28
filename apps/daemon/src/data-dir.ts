import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface DataPaths {
  root: string
  database: string
  secrets: string
  worktrees: string
  agentHomes: string
  logs: string
  run: string
}

export function dataPaths(root: string): DataPaths {
  return {
    root,
    database: join(root, 'candy-mountain.db'),
    secrets: join(root, 'secrets'),
    worktrees: join(root, 'worktrees'),
    agentHomes: join(root, 'agent-homes'),
    logs: join(root, 'logs'),
    run: join(root, 'run'),
  }
}

export function ensureDataDir(root: string): DataPaths {
  const paths = dataPaths(root)
  for (const dir of [paths.root, paths.secrets, paths.worktrees, paths.agentHomes, paths.logs, paths.run]) {
    // Owner-only because the tree holds secrets and agent credentials.
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  return paths
}
