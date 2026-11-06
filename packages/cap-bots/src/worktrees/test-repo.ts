import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Identity plus empty global/system config so the developer's own git settings (signing, hooks) stay out of the tests. */
export const TEST_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

export interface TempGitRepo {
  root: string
  /** Bare repository acting as origin. */
  origin: string
  /** The project's checkout, cloned from origin with `main` checked out. */
  clone: string
  git(cwd: string, ...args: string[]): string
  /** Commits a file on `main` in a separate clone and pushes it, so the project clone only sees it after a fetch. */
  pushToOrigin(file: string, content: string): string
  cleanup(): void
}

export function createTempGitRepo({ remote = true }: { remote?: boolean } = {}): TempGitRepo {
  const root = mkdtempSync(join(tmpdir(), 'candy-mountain-worktrees-'))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: TEST_GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (cwd: string, file: string, content: string, message: string) => {
    writeFileSync(join(cwd, file), content)
    git(cwd, 'add', file)
    git(cwd, 'commit', '--quiet', '-m', message)
    return git(cwd, 'rev-parse', 'HEAD')
  }

  const seed = join(root, 'seed')
  git(root, 'init', '--quiet', '--initial-branch=main', seed)
  commit(seed, 'README.md', 'hello\n', 'initial')
  const origin = join(root, 'origin.git')
  git(root, 'clone', '--quiet', '--bare', seed, origin)
  const clone = join(root, 'clone')
  if (remote) {
    git(root, 'clone', '--quiet', '--branch', 'main', origin, clone)
  }
  else {
    git(root, 'clone', '--quiet', '--branch', 'main', origin, clone)
    git(clone, 'remote', 'remove', 'origin')
  }

  let pushes = 0
  return {
    root,
    origin,
    clone,
    git,
    pushToOrigin(file, content) {
      const other = join(root, `pusher-${++pushes}`)
      git(root, 'clone', '--quiet', '--branch', 'main', origin, other)
      const sha = commit(other, file, content, `add ${file}`)
      git(other, 'push', '--quiet', 'origin', 'main')
      return sha
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}
