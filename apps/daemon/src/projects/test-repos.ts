import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TempRepos {
  root: string
  dir(name: string, options?: { beads?: boolean, git?: boolean, remotes?: Record<string, string> }): string
  cleanup(): void
}

export function createTempRepos(): TempRepos {
  const root = mkdtempSync(join(tmpdir(), 'candy-mountain-repos-'))
  return {
    root,
    dir(name, options = {}) {
      const path = join(root, name)
      mkdirSync(path, { recursive: true })
      if (options.beads) mkdirSync(join(path, '.beads'))
      if (options.git) execFileSync('git', ['init', '--quiet', path])
      for (const [remote, url] of Object.entries(options.remotes ?? {})) {
        execFileSync('git', ['-C', path, 'remote', 'add', remote, url])
      }
      return path
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}
