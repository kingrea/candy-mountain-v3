import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { curateAgentEnv } from '../acp'
import { hasBd } from '../issues/test-workspace'
import { beadsEnvForWorktree } from './bd-env'
import { createTempGitRepo, TEST_GIT_ENV, type TempGitRepo } from './test-repo'

interface BdIssue { id: string, title: string }

let repo: TempGitRepo | undefined

afterEach(() => {
  repo?.cleanup()
  repo = undefined
})

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...TEST_GIT_ENV, BD_NON_INTERACTIVE: '1', ...extra }
  if (!('BEADS_DIR' in extra)) delete env.BEADS_DIR
  delete env.BEADS_DB
  return env
}

function bd(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): unknown {
  return JSON.parse(execFileSync('bd', [...args, '--json'], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as unknown
}

function setUp({ stealth }: { stealth: boolean }) {
  const created = createTempGitRepo({ remote: false })
  repo = created
  execFileSync('bd', ['init', '--non-interactive', '--prefix', 'wt', '--skip-agents', '--quiet', ...(stealth ? ['--stealth'] : [])], { cwd: created.clone, env: cleanEnv(), stdio: 'ignore' })
  const worktree = join(created.root, 'worktrees', 'lease')
  mkdirSync(join(created.root, 'worktrees'))
  execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'cm/bot/test', worktree, 'main'], { cwd: created.clone, env: cleanEnv(), stdio: 'ignore' })
  return { clone: created.clone, worktree }
}

describe('beadsEnvForWorktree', () => {
  it('returns null for a project without .beads', async () => {
    repo = createTempGitRepo({ remote: false })
    expect(await beadsEnvForWorktree(repo.clone)).toBeNull()
  })

  it('points BEADS_DIR at the main checkout and survives the agent env allowlist', async () => {
    repo = createTempGitRepo({ remote: false })
    mkdirSync(join(repo.clone, '.beads'))
    const result = await beadsEnvForWorktree(repo.clone)
    expect(result).toEqual({ beadsDir: join(repo.clone, '.beads'), env: { BEADS_DIR: join(repo.clone, '.beads'), BD_NON_INTERACTIVE: '1' } })

    const curated = curateAgentEnv({ base: { PATH: '/usr/bin', BEADS_DIR: '/elsewhere/.beads', BEADS_DB: '/elsewhere/db' }, extra: result!.env })
    expect(curated).toEqual({ PATH: '/usr/bin', BEADS_DIR: join(repo.clone, '.beads'), BD_NON_INTERACTIVE: '1' })
  })
})

describe.skipIf(!hasBd)('bd from a worktree with beadsEnvForWorktree', () => {
  it.each([
    { stealth: false, layout: '.beads committed to the branch' },
    { stealth: true, layout: '.beads untracked (stealth)' },
  ])('lands issues in the main checkout database when $layout', async ({ stealth }) => {
    const { clone, worktree } = setUp({ stealth })
    const hadBeads = existsSync(join(worktree, '.beads'))
    expect(hadBeads).toBe(!stealth)

    const result = await beadsEnvForWorktree(clone)
    const created = bd(worktree, cleanEnv(result!.env), 'create', '--title', 'Filed from the worktree') as BdIssue

    const listed = bd(clone, cleanEnv(), 'list', '--all', '--limit', '0') as BdIssue[]
    expect(listed.map(issue => issue.id)).toContain(created.id)
    expect(existsSync(join(worktree, '.beads'))).toBe(hadBeads)
    expect(existsSync(join(worktree, '.beads', 'embeddeddolt'))).toBe(false)
    expect(existsSync(join(worktree, '.beads', 'dolt'))).toBe(false)
    expect(repo!.git(worktree, 'status', '--porcelain')).toBe('')
  }, 60_000)

  it('resolves through BEADS_DIR alone, not git worktree discovery', async () => {
    const { clone } = setUp({ stealth: true })
    const outside = join(repo!.root, 'outside')
    mkdirSync(outside)
    const result = await beadsEnvForWorktree(clone)

    expect(() => bd(outside, cleanEnv(), 'list')).toThrow()
    const created = bd(outside, cleanEnv(result!.env), 'create', '--title', 'Filed from outside any checkout') as BdIssue
    const listed = bd(clone, cleanEnv(), 'list', '--all', '--limit', '0') as BdIssue[]
    expect(listed.map(issue => issue.id)).toContain(created.id)
    expect(existsSync(join(outside, '.beads'))).toBe(false)
  }, 60_000)
})
