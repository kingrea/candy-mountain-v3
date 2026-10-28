import { existsSync } from 'node:fs'
import type { GitRunner } from './git'

export const INSPECT_FETCH_TIMEOUT_MS = 120_000

export interface WorktreeInspection {
  path: string
  exists: boolean
  /** `git status --porcelain` lines, untracked files included. */
  uncommitted: string[]
  /** Commits on HEAD that no ref of the remote contains (without a remote: that no other local branch contains). */
  unpushedCommits: number
  remote: string | null
  /** Whether the remote was fetched first; when false the comparison used the last known remote refs. */
  fetched: boolean
  /** Why removing the directory could lose work; null when it is safe to remove. */
  unsafeReason: string | null
}

export interface InspectWorktreeOptions {
  fetch?: boolean
}

export async function inspectWorktree(git: GitRunner, path: string, { fetch = true }: InspectWorktreeOptions = {}): Promise<WorktreeInspection> {
  const result: WorktreeInspection = { path, exists: existsSync(path), uncommitted: [], unpushedCommits: 0, remote: null, fetched: false, unsafeReason: null }
  if (!result.exists) return result
  try {
    // --no-optional-locks: an agent may be running git in the same worktree.
    const status = await git(path, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'])
    result.uncommitted = status.split('\n').filter(Boolean)
    await git(path, ['rev-parse', '--verify', '--quiet', 'HEAD'])
    const branch = await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => null)
    const remotes = (await git(path, ['remote'])).split('\n').filter(Boolean)
    result.remote = remotes.includes('origin') ? 'origin' : remotes[0] ?? null
    if (result.remote !== null && fetch) {
      result.fetched = await git(path, ['fetch', '--quiet', result.remote], { timeoutMs: INSPECT_FETCH_TIMEOUT_MS }).then(() => true, () => false)
    }
    const exclusions = result.remote !== null ? [`--remotes=${result.remote}`] : [...(branch ? [`--exclude=${branch}`] : []), '--branches']
    result.unpushedCommits = Number(await git(path, ['rev-list', '--count', 'HEAD', '--not', ...exclusions]))
  }
  catch (error) {
    result.unsafeReason = `Cannot inspect the worktree: ${error instanceof Error ? error.message : String(error)}`
    return result
  }
  const reasons: string[] = []
  if (result.uncommitted.length > 0) reasons.push(`${result.uncommitted.length} uncommitted change(s)`)
  if (result.unpushedCommits > 0) reasons.push(`${result.unpushedCommits} commit(s) not on ${result.remote ?? 'any other local branch'}`)
  result.unsafeReason = reasons.length > 0 ? reasons.join(', ') : null
  return result
}
