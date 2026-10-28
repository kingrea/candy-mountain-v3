import { mkdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DECISION_META_KEY } from '@candy-mountain/claude-acp'
import { createAcpHarness, type AcpHarness } from './harness'
import { AcpAuthRequiredError } from './session'
import { collect, createTempHome, fakeBins, fakeClaude, textOf, waitForEvent, waitForGone, type TempHome } from './test-support'

interface LaunchSeen {
  args: string[]
  configDir: string
  oauthToken?: string
  authEnv: string[]
}

// The daemon's own environment is the hostile case: keys that must never reach the CLI.
const DAEMON_ENV: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-secret', ANTHROPIC_AUTH_TOKEN: 'secret', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CONFIG_DIR: '/someone/elses/login', CM_SECRETS_KEY: 'secret' }

describe('ACP harness driving the Claude shim and the fake claude', () => {
  let home: TempHome
  let claude: string
  let harness: AcpHarness

  beforeEach(() => {
    home = createTempHome('cm-acp-claude-')
    mkdirSync(home.cwd, { recursive: true })
    claude = fakeClaude(home.root)
    harness = createAcpHarness({ bins: fakeBins, env: DAEMON_ENV, killTimeoutMs: 1000 })
  })

  afterEach(async () => {
    await harness.close()
    home.cleanup()
  })

  const start = (extra: Partial<Parameters<AcpHarness['startSession']>[0]> = {}) => harness.startSession({ family: 'claude-code', cwd: home.cwd, configHome: home.configHome, command: claude, ...extra })

  it('runs claude in the config home with posture flags and no API-key variables', async () => {
    const session = await start({ flags: ['--permission-mode', 'plan', '--allowedTools', 'Bash(bd *)'], env: { CLAUDE_CODE_OAUTH_TOKEN: 'setup-token' } })
    const events = collect(session)
    expect(session.upstreamSessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect((await session.prompt('launch-env')).stopReason).toBe('end_turn')
    const seen = JSON.parse(textOf(events).join('')) as LaunchSeen
    expect(seen.configDir).toBe(home.configHome)
    expect(seen.authEnv).toEqual([])
    expect(seen.oauthToken).toBe('setup-token')
    expect(seen.args.slice(-4)).toEqual(['--permission-mode', 'plan', '--allowedTools', 'Bash(bd *)'])
    expect(seen.args[seen.args.indexOf('--session-id') + 1]).toBe(session.upstreamSessionId)
    expect(events.at(-1)).toMatchObject({ kind: 'turn_end', stopReason: 'end_turn' })
  }, 20_000)

  it('reports a config home without a login as auth_required', async () => {
    await expect(start({ env: { FIXTURE_ACCOUNT: 'none' } })).rejects.toBeInstanceOf(AcpAuthRequiredError)
    expect(harness.list()).toEqual([])
  }, 20_000)

  it('resumes by upstream session id', async () => {
    const first = await start()
    const firstEvents = collect(first)
    await first.prompt('session-id')
    const upstreamSessionId = first.upstreamSessionId
    expect(textOf(firstEvents).join('')).toBe(upstreamSessionId)
    await first.close()
    expect(await waitForGone(first.pid)).toBe(true)

    const second = await start({ upstreamSessionId })
    const events = collect(second)
    await second.prompt('launch-env')
    const seen = JSON.parse(textOf(events).join('')) as LaunchSeen
    expect(seen.args[seen.args.indexOf('--resume') + 1]).toBe(upstreamSessionId)
    expect(seen.args).not.toContain('--session-id')
  }, 30_000)

  it('relays a permission request and the denial chosen by kind', async () => {
    const session = await start()
    const events = collect(session)
    const asked = waitForEvent(session, 'permission_request')
    const turn = session.prompt('permission')
    const request = await asked
    expect(request.options.map(option => option.kind)).toEqual(['allow_once', 'allow_always', 'allow_always', 'reject_once'])
    expect(request.toolCall.rawInput).toEqual({ command: 'git status', description: 'check the tree' })
    const deny = request.options.find(option => option.kind === 'reject_once')!
    expect(request.respond({ outcome: { outcome: 'selected', optionId: deny.optionId }, _meta: { [DECISION_META_KEY]: { explanation: 'not now' } } })).toBe(true)
    await turn
    const result = JSON.parse(textOf(events).join('')) as { scenario: string, response: { behavior: string, message: string } }
    expect(result.scenario).toBe('permission')
    expect(result.response).toMatchObject({ behavior: 'deny', message: 'not now' })
  }, 20_000)

  it('relays a question as a form and returns the answer', async () => {
    const session = await start()
    const events = collect(session)
    const asked = waitForEvent(session, 'question')
    const turn = session.prompt('question:single')
    const question = await asked
    expect(question.request.message).toBe('Which formatter?')
    expect(question.respond({ action: 'accept', content: { question_0: 'dprint' } })).toBe(true)
    await turn
    const result = JSON.parse(textOf(events).join('')) as { response: { behavior: string, updatedInput: { answers: Record<string, string> } } }
    expect(result.response.behavior).toBe('allow')
    expect(result.response.updatedInput.answers).toEqual({ 'Which formatter?': 'dprint' })
  }, 20_000)

  it('cancels a running turn through the interrupt control request', async () => {
    const session = await start()
    const turn = session.prompt('wait')
    await new Promise(resolve => setTimeout(resolve, 200))
    await session.cancel()
    expect((await turn).stopReason).toBe('cancelled')
    expect(session.status).toBe('idle')
  }, 20_000)

  it('maps a tool call and its result from the stream', async () => {
    const session = await start()
    const events = collect(session)
    await session.prompt('tool-call')
    const kinds = events.map(event => event.kind)
    expect(kinds).toContain('tool_call')
    expect(kinds).toContain('tool_result')
    expect(kinds.indexOf('tool_call')).toBeLessThan(kinds.indexOf('tool_result'))
    expect(textOf(events).join('')).toBe('Done.')
  }, 20_000)
})
