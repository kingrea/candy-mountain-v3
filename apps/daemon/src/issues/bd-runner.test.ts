import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { runBd } from './bd-runner'
import { IssueError } from './errors'
import { createTempBeadsWorkspace, hasBd, type TempBeadsWorkspace } from './test-workspace'

const scratch = mkdtempSync(join(tmpdir(), 'candy-mountain-bd-runner-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function checkout(name: string): string {
  const path = join(scratch, name)
  mkdirSync(join(path, '.beads'), { recursive: true })
  return path
}

function fakeBd(script: string) {
  const bin = mkdtempSync(join(scratch, 'bin-'))
  writeFileSync(join(bin, 'bd'), `#!/bin/sh\n${script}\n`)
  chmodSync(join(bin, 'bd'), 0o755)
  vi.stubEnv('PATH', `${bin}${delimiter}${process.env.PATH ?? ''}`)
}

afterEach(() => vi.unstubAllEnvs())

async function failure(promise: Promise<unknown>): Promise<IssueError> {
  const error = await promise.then(() => null, (e: unknown) => e)
  expect(error).toBeInstanceOf(IssueError)
  return error as IssueError
}

describe('runBd', () => {
  it('refuses a checkout without a .beads directory', async () => {
    const bare = join(scratch, 'bare')
    mkdirSync(bare)
    const error = await failure(runBd(bare, ['list']))
    expect(error.code).toBe('no_issue_tracker')
    expect(error.message).toContain(bare)
  })

  it('appends --json and parses the output', async () => {
    fakeBd('echo "[\\"$*\\"]"')
    expect(await runBd(checkout('args'), ['list', '--all'])).toEqual(['list --all --json'])
  })

  it('treats an error payload as a failure even when bd exits zero', async () => {
    fakeBd('echo \'{"error":"no issues found matching the provided IDs","schema_version":1}\'')
    const error = await failure(runBd(checkout('quirk'), ['show', 'x-1']))
    expect(error).toMatchObject({ code: 'not_found', message: 'no issues found matching the provided IDs' })
  })

  it('surfaces the CLI message when bd fails', async () => {
    fakeBd('echo "warning: noise" >&2; echo "Error: database is locked" >&2; exit 1')
    const error = await failure(runBd(checkout('fails'), ['list']))
    expect(error).toMatchObject({ code: 'tracker_failed', status: 502, message: 'database is locked' })
  })

  it('rejects output that is not JSON', async () => {
    fakeBd('echo hello')
    expect((await failure(runBd(checkout('text'), ['list']))).code).toBe('tracker_failed')
  })

  it('times out a hung bd', async () => {
    fakeBd('exec sleep 5')
    const error = await failure(runBd(checkout('slow'), ['list'], { timeoutMs: 200 }))
    expect(error).toMatchObject({ code: 'tracker_timeout', status: 504 })
  })

  it('reports a missing bd binary', async () => {
    vi.stubEnv('PATH', join(scratch, 'empty-path'))
    expect((await failure(runBd(checkout('nobin'), ['list']))).code).toBe('tracker_unavailable')
  })
})

describe.skipIf(!hasBd)('runBd against a real workspace', () => {
  let workspace: TempBeadsWorkspace
  beforeAll(() => {
    workspace = createTempBeadsWorkspace('rr')
  }, 60_000)
  afterAll(() => workspace?.cleanup())

  it('reads issues and answers not_found for an unknown id', async () => {
    const id = workspace.create('Real issue')
    expect(await runBd(workspace.path, ['show', id])).toMatchObject([{ id, title: 'Real issue' }])
    const error = await failure(runBd(workspace.path, ['show', 'rr-nope']))
    expect(error.code).toBe('not_found')
    expect((await failure(runBd(workspace.path, ['comments', 'rr-nope']))).code).toBe('not_found')
  }, 30_000)
})
