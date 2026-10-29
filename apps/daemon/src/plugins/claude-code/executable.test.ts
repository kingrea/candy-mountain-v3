import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAUDE_CODE_TYPE_ACTIONS, PLUGIN_TYPES_PATH, type ClaudeExecutableResponse } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { instanceHarness, type InstanceHarness } from '../instances/test-support'
import { claudeCodePluginType } from '../types/claude-code'
import { EXECUTABLE_REASONS, findClaudeExecutable, probeClaudeExecutable } from './executable'

const FAKE = fileURLToPath(new URL('./test-support/fake-claude.mjs', import.meta.url))

function fakeClaude(dir: string, env: Record<string, string> = {}): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'claude')
  const exports = Object.entries(env).map(([name, value]) => `${name}='${value}'`).join(' ')
  writeFileSync(path, `#!/bin/sh\n${exports} exec '${process.execPath}' '${FAKE}' "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

let scratch: string
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'candy-mountain-claude-exe-'))
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** A curated environment: the probe must not depend on the developer's own PATH or home. */
const envWith = (overrides: Record<string, string>) => ({ HOME: join(scratch, 'home'), PATH: join(scratch, 'empty'), ...overrides })

describe('findClaudeExecutable', () => {
  it('prefers PATH, in order, and reports it as on PATH', () => {
    const first = fakeClaude(join(scratch, 'first'))
    fakeClaude(join(scratch, 'second'))
    const result = findClaudeExecutable(envWith({ PATH: `${join(scratch, 'first')}:${join(scratch, 'second')}` }))
    expect(result.found).toEqual({ path: first, onPath: true })
    expect(result.searched).toEqual([join(scratch, 'first')])
  })

  it('falls back to the usual install directories under HOME and says it is off PATH', () => {
    const installed = fakeClaude(join(scratch, 'home', '.local', 'bin'))
    const result = findClaudeExecutable(envWith({}))
    expect(result.found).toEqual({ path: installed, onPath: false })
    expect(result.searched).toEqual([join(scratch, 'empty'), join(scratch, 'home', '.local', 'bin')])
  })

  it('ignores a claude that is not executable and lists everything it looked in', () => {
    mkdirSync(join(scratch, 'bin'), { recursive: true })
    writeFileSync(join(scratch, 'bin', 'claude'), 'not runnable')
    const result = findClaudeExecutable(envWith({ PATH: join(scratch, 'bin') }))
    expect(result.found).toBeUndefined()
    expect(result.searched).toEqual([join(scratch, 'bin'), join(scratch, 'home', '.local', 'bin'), join(scratch, 'home', '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'])
  })
})

describe('probeClaudeExecutable', () => {
  it('runs the found executable and reports its version', async () => {
    fakeClaude(join(scratch, 'bin'))
    const result = await probeClaudeExecutable({ env: envWith({ PATH: join(scratch, 'bin') }) })
    expect(result).toEqual({ found: true, path: join(scratch, 'bin', 'claude'), onPath: true, version: '9.9.9' })
  })

  it('checks an explicit path and explains a missing, unrunnable or broken file', async () => {
    const env = envWith({})
    expect(await probeClaudeExecutable({ path: join(scratch, 'nope'), env })).toEqual({ found: false, reason: EXECUTABLE_REASONS.missing, searched: [join(scratch, 'nope')] })

    writeFileSync(join(scratch, 'plain'), 'text')
    expect(await probeClaudeExecutable({ path: join(scratch, 'plain'), env })).toMatchObject({ found: false, reason: EXECUTABLE_REASONS.notExecutable })

    const broken = fakeClaude(join(scratch, 'broken'), { FAKE_CLAUDE_MODE: 'no-version' })
    expect(await probeClaudeExecutable({ path: broken, env })).toMatchObject({ found: false, reason: EXECUTABLE_REASONS.failed })

    const good = fakeClaude(join(scratch, 'good'))
    expect(await probeClaudeExecutable({ path: good, env })).toEqual({ found: true, path: good, onPath: false, version: '9.9.9' })
  })

  it('reports nothing found with the directories it searched', async () => {
    const result = await probeClaudeExecutable({ env: envWith({}) })
    expect(result).toMatchObject({ found: false, reason: EXECUTABLE_REASONS.notFound })
    expect((result as { searched: string[] }).searched[0]).toBe(join(scratch, 'empty'))
  })
})

describe('GET /plugin-types/claude-code/executable', () => {
  let h: InstanceHarness
  let originalPath: string | undefined
  beforeEach(() => {
    h = instanceHarness([claudeCodePluginType])
    originalPath = process.env.PATH
  })
  afterEach(() => {
    process.env.PATH = originalPath
    h.close()
  })

  const call = (query = '', roles?: string[]) => h.app(roles).request(`${PLUGIN_TYPES_PATH}/claude-code/${CLAUDE_CODE_TYPE_ACTIONS.executable}${query}`)

  it('finds the claude on the daemon PATH', async () => {
    fakeClaude(join(scratch, 'bin'))
    process.env.PATH = join(scratch, 'bin')
    const res = await call()
    expect(res.status, await res.clone().text()).toBe(200)
    expect(await res.json() as ClaudeExecutableResponse).toEqual({ found: true, path: join(scratch, 'bin', 'claude'), onPath: true, version: '9.9.9' })
  })

  it('checks the path given in the query', async () => {
    const path = fakeClaude(join(scratch, 'elsewhere'))
    const res = await call(`?path=${encodeURIComponent(path)}`)
    expect(res.status).toBe(200)
    expect(await res.json() as ClaudeExecutableResponse).toMatchObject({ found: true, path, onPath: false })
    expect((await call('?path=relative/claude')).status).toBe(400)
  })

  it('is admin-only and unknown to other types and actions', async () => {
    expect((await call('', ['member'])).status).toBe(403)
    expect((await h.app().request(`${PLUGIN_TYPES_PATH}/claude-code/nope`)).status).toBe(404)
    expect((await h.app().request(`${PLUGIN_TYPES_PATH}/gitlab/${CLAUDE_CODE_TYPE_ACTIONS.executable}`)).status).toBe(404)
    expect((await h.app().request(`${PLUGIN_TYPES_PATH}/claude-code/${CLAUDE_CODE_TYPE_ACTIONS.executable}`, { method: 'POST' })).status).toBe(404)
  })
})
