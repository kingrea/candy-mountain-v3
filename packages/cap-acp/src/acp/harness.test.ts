import { existsSync, mkdirSync, statSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AcpSessionEvent } from './events'
import { AcpLaunchError } from './families'
import { createAcpHarness, type AcpHarness } from './harness'
import { AcpAuthRequiredError, AcpStartError } from './session'
import { collect, createTempHome, fakeBins, processAlive, textOf, waitForEvent, waitForGone, type TempHome } from './test-support'

const POLLUTED_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  ANTHROPIC_API_KEY: 'sk-ant-secret',
  ANTHROPIC_AUTH_TOKEN: 'secret',
  CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'secret',
  OPENAI_API_KEY: 'sk-secret',
  CM_SECRETS_KEY: 'secret',
  CM_ADMIN_PASSWORD: 'secret',
  AWS_SECRET_ACCESS_KEY: 'secret',
  GITHUB_TOKEN: 'secret',
  NODE_OPTIONS: '--require nothing',
  EDITOR: 'vim',
  BROWSER: '/usr/bin/firefox',
  DEFAULT_AUTH_REQUEST: '{"methodId":"chat-gpt"}',
  APP_SERVER_LOGS: '/tmp/codex-logs',
  INITIAL_AGENT_MODE: 'agent',
  CODEX_CONFIG: '{"approvals_reviewer":"auto_review"}',
  MODEL_PROVIDER: 'proxy',
  CODEX_API_KEY: 'secret',
}

describe('ACP harness with a fake agent', () => {
  let home: TempHome
  let harness: AcpHarness

  beforeEach(() => {
    home = createTempHome()
    mkdirSync(home.cwd, { recursive: true })
    harness = createAcpHarness({ bins: fakeBins, env: POLLUTED_ENV, killTimeoutMs: 1000 })
  })

  afterEach(async () => {
    await harness.close()
    home.cleanup()
  })

  const start = (extra: Partial<Parameters<AcpHarness['startSession']>[0]> = {}) => harness.startSession({ family: 'codex', cwd: home.cwd, configHome: home.configHome, ...extra })

  it('runs a prompt and emits text, turn end and a registry entry', async () => {
    const session = await start()
    const events = collect(session)
    expect(session.status).toBe('idle')
    expect(session.upstreamSessionId).toMatch(/^fake-/)
    expect(harness.list()).toEqual([session])
    expect(harness.get(session.id)).toBe(session)

    const result = await session.prompt('hello')
    expect(result).toEqual({ stopReason: 'end_turn', usage: { totalTokens: 12, inputTokens: 10, outputTokens: 2 } })
    expect(textOf(events)).toEqual(['echo: hello'])
    expect(events.map(event => event.kind)).toEqual(['text', 'turn_end'])
    expect(events.map(event => event.seq)).toEqual([1, 2])
    expect(events.every(event => event.sessionId === session.id && !Number.isNaN(Date.parse(event.at)))).toBe(true)
  })

  it('maps reasoning, tool calls, tool results, usage and unknown updates', async () => {
    const session = await start()
    const events = collect(session)
    await session.prompt('think')
    await session.prompt('tool')
    await session.prompt('usage')
    const kinds = events.map(event => event.kind)
    expect(kinds).toEqual(['reasoning', 'text', 'turn_end', 'tool_call', 'tool_result', 'text', 'turn_end', 'usage', 'other', 'text', 'turn_end'])
    const toolCall = events.find(event => event.kind === 'tool_call')!
    expect(toolCall.kind === 'tool_call' && toolCall.toolCall).toMatchObject({ toolCallId: 'call-1', title: 'ls', kind: 'execute', status: 'in_progress' })
    const toolResult = events.find(event => event.kind === 'tool_result')!
    expect(toolResult.kind === 'tool_result' && toolResult.update).toMatchObject({ toolCallId: 'call-1', status: 'completed' })
    const usage = events.find(event => event.kind === 'usage')!
    expect(usage.kind === 'usage' && usage.usage).toEqual({ used: 1200, size: 200000 })
    const other = events.find(event => event.kind === 'other')!
    expect(other.kind === 'other' && other.update).toEqual({ sessionUpdate: 'current_mode_update', currentModeId: 'default' })
  })

  it('relays a permission request and the answer chosen by option kind', async () => {
    const session = await start()
    const events = collect(session)
    const asked = waitForEvent(session, 'permission_request')
    const turn = session.prompt('permission')
    const request = await asked
    expect(request.toolCall).toMatchObject({ toolCallId: 'call-2', kind: 'delete' })
    const deny = request.options.find(option => option.kind === 'reject_once')!
    expect(request.respond({ outcome: { outcome: 'selected', optionId: deny.optionId } })).toBe(true)
    expect(request.respond({ outcome: { outcome: 'cancelled' } })).toBe(false)
    await turn
    expect(textOf(events)).toEqual(['permission:{"outcome":"selected","optionId":"reject"}'])
    expect(events.some(event => event.kind === 'request_cancelled')).toBe(false)
  })

  it('relays a question and its answer', async () => {
    const session = await start()
    const events = collect(session)
    const asked = waitForEvent(session, 'question')
    const turn = session.prompt('question')
    const question = await asked
    expect(question.request.message).toBe('Which formatter?')
    expect(question.respond({ action: 'accept', content: { formatter: 'dprint' } })).toBe(true)
    await turn
    expect(textOf(events)).toEqual(['question:{"action":"accept","content":{"formatter":"dprint"}}'])
  })

  it('cancels a running turn', async () => {
    const session = await start()
    const working = waitForEvent(session, 'text')
    const turn = session.prompt('hang')
    await working
    expect(session.status).toBe('prompting')
    await session.cancel()
    expect((await turn).stopReason).toBe('cancelled')
    expect(session.status).toBe('idle')
    await session.cancel()
  })

  it('loads a session by upstream id and continues the conversation', async () => {
    const first = await start()
    await first.prompt('one')
    const upstreamSessionId = first.upstreamSessionId
    await first.close()

    const replayed: AcpSessionEvent[] = []
    const second = await start({ upstreamSessionId, onEvent: event => replayed.push(event) })
    expect(second.upstreamSessionId).toBe(upstreamSessionId)
    expect(replayed.map(event => event.kind)).toEqual(['text', 'text'])
    expect(replayed[0]).toMatchObject({ kind: 'text', role: 'user', text: 'earlier prompt' })
    const events = collect(second)
    await second.prompt('history')
    expect(textOf(events)).toEqual(['["(loaded)","history"]'])
  })

  it('gives the child only the allowlisted environment plus the family variables', async () => {
    const session = await start({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'setup-token' } })
    const events = collect(session)
    await session.prompt('env')
    const names = JSON.parse(textOf(events)[0]!) as string[]
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'OPENAI_API_KEY', 'CM_SECRETS_KEY', 'CM_ADMIN_PASSWORD', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'EDITOR']) {
      expect(names, name).not.toContain(name)
    }
    expect(names).toEqual(expect.arrayContaining(['PATH', 'CODEX_HOME', 'NO_BROWSER', 'CLAUDE_CODE_OAUTH_TOKEN']))
    const allowed = new Set(['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'CODEX_HOME', 'NO_BROWSER', 'DEFAULT_AUTH_REQUEST', 'APP_SERVER_LOGS', 'INITIAL_AGENT_MODE', 'CODEX_CONFIG', 'CLAUDE_CODE_OAUTH_TOKEN'])
    expect(names.filter(name => !allowed.has(name))).toEqual([])
    await expect(start({ env: { OPENAI_API_KEY: 'x' } })).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it('launches the Codex adapter read-only, browserless, in the caller\'s home, with the persona as developer instructions', async () => {
    const session = await start({ codex: { developerInstructions: 'You are Pip.' } })
    const events = collect(session)
    await session.prompt('env:CODEX_HOME,NO_BROWSER,DEFAULT_AUTH_REQUEST,APP_SERVER_LOGS,INITIAL_AGENT_MODE,CODEX_CONFIG,MODEL_PROVIDER,BROWSER')
    expect(JSON.parse(textOf(events)[0]!)).toEqual({
      CODEX_HOME: home.configHome,
      NO_BROWSER: '1',
      DEFAULT_AUTH_REQUEST: '',
      APP_SERVER_LOGS: '',
      INITIAL_AGENT_MODE: 'read-only',
      CODEX_CONFIG: JSON.stringify({ developer_instructions: 'You are Pip.' }),
      MODEL_PROVIDER: null,
      BROWSER: null,
    })
  })

  it('keeps the config options the agent reports on session/new and session/load, and launches with the chosen model', async () => {
    const values = (session: { configOptions: readonly { id: string, currentValue: unknown }[] }) => Object.fromEntries(session.configOptions.map(option => [option.id, option.currentValue]))
    const fresh = await start()
    expect(values(fresh)).toEqual({ 'mode': 'read-only', 'model': 'gpt-fast', 'reasoning_effort': 'medium' })
    const chosen = await start({ codex: { model: 'gpt-deep', reasoningEffort: 'xhigh' } })
    expect(values(chosen)).toEqual({ 'mode': 'read-only', 'model': 'gpt-deep', 'reasoning_effort': 'xhigh' })
    const events = collect(chosen)
    await chosen.prompt('model')
    expect(textOf(events)).toEqual(['model:gpt-deep/xhigh'])
    await chosen.close()
    const loaded = await start({ codex: { model: 'gpt-deep' }, upstreamSessionId: chosen.upstreamSessionId })
    expect(values(loaded)).toEqual({ 'mode': 'read-only', 'model': 'gpt-deep', 'reasoning_effort': 'high' })
    const bare = await start({ env: { FAKE_ACP_CONFIG: 'none' } })
    expect(bare.configOptions).toEqual([])
  })

  it('sends Codex writable roots as session directories on session/new and session/load', async () => {
    const roots = ['/work/alpha/.beads']
    const fresh = await start({ codex: { mode: 'workspace-write', writableRoots: roots } })
    const events = collect(fresh)
    await fresh.prompt('directories')
    expect(textOf(events)).toEqual([JSON.stringify(roots)])
    await fresh.close()
    const loaded = await start({ codex: { mode: 'workspace-write', writableRoots: roots }, upstreamSessionId: fresh.upstreamSessionId })
    const loadedEvents = collect(loaded)
    await loaded.prompt('directories')
    expect(textOf(loadedEvents)).toEqual([JSON.stringify(roots)])
    const plain = await start()
    const plainEvents = collect(plain)
    await plain.prompt('directories')
    expect(textOf(plainEvents)).toEqual(['null'])
  })

  it('refuses a Codex launch that selects auto-review before spawning anything', async () => {
    await expect(start({ codex: { mode: 'agent' as 'read-only' } })).rejects.toThrow(AcpLaunchError)
    await expect(start({ env: { INITIAL_AGENT_MODE: 'agent' } })).rejects.toThrow(AcpLaunchError)
    await expect(start({ flags: ['login'] })).rejects.toThrow(AcpLaunchError)
    expect(harness.list()).toEqual([])
    expect(existsSync(home.configHome)).toBe(false)
  })

  it('creates the config home owner-only and refuses a symlinked one', async () => {
    const session = await start()
    expect(statSync(home.configHome).mode & 0o777).toBe(0o700)
    await session.close()
    mkdirSync(join(home.root, 'elsewhere'))
    symlinkSync(join(home.root, 'elsewhere'), join(home.root, 'linked'))
    await expect(start({ configHome: join(home.root, 'linked') })).rejects.toThrow(/symbolic link/)
  })

  it('reports a missing login as auth_required without keeping a process', async () => {
    const harness = createAcpHarness({ bins: fakeBins, env: { ...POLLUTED_ENV, FAKE_ACP_AUTH: 'none' } })
    await expect(harness.startSession({ family: 'codex', cwd: home.cwd, configHome: home.configHome, env: { FAKE_ACP_AUTH: 'none' } })).rejects.toBeInstanceOf(AcpAuthRequiredError)
    expect(harness.list()).toEqual([])
    await harness.close()
  })

  it('reports an agent that dies during startup with its stderr', async () => {
    await expect(start({ env: { FAKE_ACP_START: 'crash' } })).rejects.toBeInstanceOf(AcpStartError)
    await expect(start({ command: '/nonexistent/codex' })).resolves.toBeDefined()
    const broken = createAcpHarness({ bins: { ...fakeBins, codexAdapter: { command: '/nonexistent/agent', args: [] } } })
    await expect(broken.startSession({ family: 'codex', cwd: home.cwd, configHome: home.configHome })).rejects.toThrow(/nonexistent/)
    expect(harness.list()).toHaveLength(1)
  })

  it('emits auth_required when a login expires mid-conversation and error for a failed turn', async () => {
    const session = await start()
    const events = collect(session)
    await expect(session.prompt('expired')).rejects.toThrow(/Authentication required/)
    await expect(session.prompt('error')).rejects.toThrow(/model is unavailable/)
    expect(events.map(event => event.kind)).toEqual(['auth_required', 'error'])
    expect(events[1]).toMatchObject({ kind: 'error', phase: 'prompt', code: -32603 })
    expect(session.status).toBe('idle')
  })

  it('reports a crash as an unexpected exit, fails the turn and leaves the registry', async () => {
    const session = await start()
    const events = collect(session)
    const exited = waitForEvent(session, 'exited')
    await expect(session.prompt('crash')).rejects.toThrow()
    expect(await exited).toMatchObject({ code: 3, signal: null, expected: false })
    expect(session.status).toBe('closed')
    expect(harness.list()).toEqual([])
    expect(events.some(event => event.kind === 'error' && event.phase === 'prompt')).toBe(true)
    await expect(session.prompt('again')).rejects.toThrow(/closed/)
  })

  it('cancels pending requests when the session closes', async () => {
    const session = await start()
    const events = collect(session)
    const asked = waitForEvent(session, 'permission_request')
    const turn = session.prompt('permission')
    const request = await asked
    const failed = expect(turn).rejects.toThrow()
    await session.close()
    await failed
    expect(events.some(event => event.kind === 'request_cancelled' && event.requestId === request.requestId)).toBe(true)
    expect(request.respond({ outcome: { outcome: 'cancelled' } })).toBe(false)
    expect(events.at(-1)).toMatchObject({ kind: 'exited', expected: true })
  })

  it('streams events as an async iterable that ends when the process exits', async () => {
    const session = await start()
    const iterator = session.events()
    await session.prompt('hello')
    await session.close()
    const kinds: string[] = []
    for await (const event of iterator) kinds.push(event.kind)
    expect(kinds).toEqual(['text', 'turn_end', 'exited'])
  })

  it('leaves no orphans: closing the harness kills the agent and its own children', async () => {
    const session = await start()
    const other = await start()
    const events = collect(session)
    await session.prompt('spawn-child')
    const grandchild = Number(textOf(events)[0])
    expect(processAlive(session.pid)).toBe(true)
    expect(processAlive(grandchild)).toBe(true)

    await harness.close()
    expect(harness.closed).toBe(true)
    expect(await waitForGone(session.pid)).toBe(true)
    expect(await waitForGone(other.pid)).toBe(true)
    expect(await waitForGone(grandchild)).toBe(true)
    expect(harness.list()).toEqual([])
    await expect(start()).rejects.toThrow(/closed/)
  })
})

describe('ACP session handle', () => {
  it('refuses a relative cwd before spawning anything', async () => {
    const home = createTempHome()
    const harness = createAcpHarness({ bins: fakeBins })
    await expect(harness.startSession({ family: 'codex', cwd: 'relative', configHome: home.configHome })).rejects.toThrow(/absolute/)
    expect(harness.list()).toEqual([])
    expect(existsSync(home.configHome)).toBe(false)
    await harness.close()
    home.cleanup()
  })

  it('kills a hung agent with SIGKILL after the grace period', async () => {
    const home = createTempHome()
    mkdirSync(home.cwd, { recursive: true })
    const harness = createAcpHarness({ bins: { ...fakeBins, codexAdapter: { command: process.execPath, args: ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'] } }, startTimeoutMs: 500, killTimeoutMs: 200 })
    await expect(harness.startSession({ family: 'codex', cwd: home.cwd, configHome: home.configHome, onEvent: () => {} })).rejects.toThrow(/timed out/)
    expect(harness.list()).toEqual([])
    await harness.close()
    home.cleanup()
  })
})
