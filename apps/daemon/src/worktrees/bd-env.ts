import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export interface WorktreeBeadsEnv {
  /** The main checkout's `.beads`, which a sandboxed agent must also be allowed to write. */
  beadsDir: string
  /** Session environment additions, passed as `startSession({ env })`. */
  env: { BEADS_DIR: string, BD_NON_INTERACTIVE: '1' }
}

/** Points every bd call from a worktree at the project's main checkout database; null when the project has no `.beads`. */
export async function beadsEnvForWorktree(projectPath: string): Promise<WorktreeBeadsEnv | null> {
  const beadsDir = join(resolve(projectPath), '.beads')
  const isDirectory = await stat(beadsDir).then(s => s.isDirectory(), () => false)
  if (!isDirectory) return null
  return { beadsDir, env: { BEADS_DIR: beadsDir, BD_NON_INTERACTIVE: '1' } }
}
