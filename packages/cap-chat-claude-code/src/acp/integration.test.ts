import { accessSync, constants, mkdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAcpHarness, type AcpHarness } from './harness'
import { AcpAuthRequiredError } from './session'
import { collect, createTempHome, hasBuiltShim, textOf, type TempHome } from './test-support'

// Real CLIs. CM_TEST_CLAUDE_BIN names a claude executable (else PATH); CM_TEST_CLAUDE_CONFIG_HOME / CM_TEST_CODEX_HOME
// name logged-in homes for a real prompt, which costs a model call and is therefore opt-in.
function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    }
    catch { /* keep looking */ }
  }
  return undefined
}

const claudeBin = process.env.CM_TEST_CLAUDE_BIN ?? onPath('claude')
const claudeHome = process.env.CM_TEST_CLAUDE_CONFIG_HOME
const codexHome = process.env.CM_TEST_CODEX_HOME
const PROMPT = 'Reply with exactly the single word pong and nothing else.'

describe.skipIf(!claudeBin || !hasBuiltShim)('ACP harness with the real claude CLI', () => {
  let home: TempHome
  let harness: AcpHarness

  beforeEach(() => {
    home = createTempHome('cm-acp-real-claude-')
    mkdirSync(home.cwd, { recursive: true })
    harness = createAcpHarness()
  })

  afterEach(async () => {
    await harness.close()
    home.cleanup()
  })

  it('reports a fresh config home as auth_required', async () => {
    await expect(harness.startSession({ family: 'claude-code', cwd: home.cwd, configHome: home.configHome, command: claudeBin })).rejects.toBeInstanceOf(AcpAuthRequiredError)
    expect(harness.list()).toEqual([])
  }, 60_000)

  it.skipIf(!claudeHome)('runs a prompt, resumes it and cancels a turn on a logged-in home', async () => {
    const session = await harness.startSession({ family: 'claude-code', cwd: home.cwd, configHome: claudeHome!, command: claudeBin, flags: ['--permission-mode', 'plan'] })
    const events = collect(session)
    expect((await session.prompt(PROMPT)).stopReason).toBe('end_turn')
    expect(textOf(events).join('').toLowerCase()).toContain('pong')
    await session.close()

    const resumed = await harness.startSession({ family: 'claude-code', cwd: home.cwd, configHome: claudeHome!, command: claudeBin, flags: ['--permission-mode', 'plan'], upstreamSessionId: session.upstreamSessionId })
    const resumedEvents = collect(resumed)
    expect((await resumed.prompt('What single word did you just reply with? Answer with that word only.')).stopReason).toBe('end_turn')
    expect(textOf(resumedEvents).join('').toLowerCase()).toContain('pong')

    const turn = resumed.prompt('Count slowly from one to one thousand, one number per line.')
    await new Promise(resolve => setTimeout(resolve, 1500))
    await resumed.cancel()
    expect((await turn).stopReason).toBe('cancelled')
  }, 180_000)
})

describe('ACP harness with the real Codex adapter', () => {
  let home: TempHome
  let harness: AcpHarness

  beforeEach(() => {
    home = createTempHome('cm-acp-real-codex-')
    mkdirSync(home.cwd, { recursive: true })
    harness = createAcpHarness()
  })

  afterEach(async () => {
    await harness.close()
    home.cleanup()
  })

  it('reports a fresh CODEX_HOME as auth_required', async () => {
    await expect(harness.startSession({ family: 'codex', cwd: home.cwd, configHome: home.configHome })).rejects.toBeInstanceOf(AcpAuthRequiredError)
    expect(harness.list()).toEqual([])
  }, 60_000)

  it.skipIf(!codexHome)('runs a prompt, resumes it and cancels a turn on a logged-in home', async () => {
    const session = await harness.startSession({ family: 'codex', cwd: home.cwd, configHome: codexHome!, codex: { mode: 'read-only' } })
    const events = collect(session)
    expect((await session.prompt(PROMPT)).stopReason).toBe('end_turn')
    expect(textOf(events).join('').toLowerCase()).toContain('pong')
    await session.close()

    const resumed = await harness.startSession({ family: 'codex', cwd: home.cwd, configHome: codexHome!, codex: { mode: 'read-only' }, upstreamSessionId: session.upstreamSessionId })
    const resumedEvents = collect(resumed)
    expect((await resumed.prompt('What single word did you just reply with? Answer with that word only.')).stopReason).toBe('end_turn')
    expect(textOf(resumedEvents).join('').toLowerCase()).toContain('pong')

    const turn = resumed.prompt('Count slowly from one to one thousand, one number per line.')
    await new Promise(resolve => setTimeout(resolve, 1500))
    await resumed.cancel()
    expect((await turn).stopReason).toBe('cancelled')
  }, 180_000)
})
