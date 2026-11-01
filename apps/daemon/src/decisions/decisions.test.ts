import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { projectSessionsPath, sessionDecisionPath, sessionDecisionsPath, sessionEventsPath, sessionPromptPath, sessionCancelPath, type AgentSession, type AgentSessionEvent, type AgentSessionEventKind, type ApiErrorBody, type Decision, type DecisionListResponse, type DecisionResponse, type PluginTypeId, type SessionListResponse, type SessionResponse } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeBins } from '../acp/test-support'
import { createTestApp } from '../testing/platform'
import { pluginInstances } from '../db/schema'
import { startAcpPlatform, type AcpPlatform, type AcpPlatformOptions } from '../chat-claude-code/test-support'
import { createPluginInstance } from '../plugins/instances/instances'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject } from '../projects/projects'
import type { SessionManager } from '../sessions'
import { createTempDataDir, type TempDataDir } from '../testing'
import { resolveDecisionSettings } from './config'
import { DecisionError } from './errors'

let temp: TempDataDir | undefined
let platform: AcpPlatform | undefined

afterEach(async () => {
  await platform?.sessions.close()
  platform?.close()
  platform = undefined
  temp?.cleanup()
  temp = undefined
})

async function boot(options: AcpPlatformOptions = {}): Promise<{ p: AcpPlatform, session: AgentSession }> {
  temp = createTempDataDir()
  const p = startAcpPlatform(temp.root, { acp: { bins: fakeBins, killTimeoutMs: 1000 }, ...options })
  platform = p
  const path = join(temp.root, '..', 'repos', 'alpha')
  mkdirSync(path, { recursive: true })
  const project = await createProject(p.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path } })
  setEnabledModules(p.db, project.id, ['agent-hub'])
  healthyPlugin(p, project.id, 'codex')
  const res = await call(p, 'POST', projectSessionsPath('alpha'), { family: 'codex' })
  expect(res.status).toBe(201)
  return { p, session: ((await res.json()) as SessionResponse).session }
}

/** Stands in for a passing connection test: the chat gate only reads the stored result. */
function healthyPlugin(p: AcpPlatform, projectId: string, type: PluginTypeId): void {
  const instance = createPluginInstance({ db: p.db, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly }, { type, scope: 'project', projectId, config: {}, secrets: {} })
  p.db.update(pluginInstances).set({ health: { healthy: true }, healthCheckedAt: new Date().toISOString() }).where(eq(pluginInstances.id, instance.id)).run()
}

const appOf = (p: AcpPlatform) => createTestApp({ db: p.db, paths: p.paths, pluginTypes: p.pluginTypes, secrets: p.secrets.writeOnly, secretsReader: p.secrets, families: p.families, runtime: p.runtime })

function call(p: AcpPlatform, method: string, path: string, body?: unknown) {
  return appOf(p).request(path, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

async function errorOf(res: Response) {
  return { status: res.status, code: ((await res.json()) as ApiErrorBody).error.code }
}

function waitFor(sessions: SessionManager, id: string, kind: AgentSessionEventKind, timeoutMs = 10_000): Promise<AgentSessionEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`No ${kind} event within ${timeoutMs}ms`)) }, timeoutMs)
    const unsubscribe = sessions.subscribe(id, (message) => {
      if (message.type !== 'event' || message.event.kind !== kind) return
      clearTimeout(timer)
      unsubscribe()
      resolve(message.event)
    })
  })
}

async function promptForDecision(p: AcpPlatform, session: AgentSession, text: string): Promise<Decision> {
  const opened = waitFor(p.sessions, session.id, 'decision_opened')
  expect((await call(p, 'POST', sessionPromptPath('alpha', session.id), { text })).status).toBe(202)
  const event = await opened
  if (event.kind !== 'decision_opened') throw new Error('unreachable')
  return event.decision
}

function answer(p: AcpPlatform, session: AgentSession, decision: Decision, body: unknown) {
  return call(p, 'POST', sessionDecisionPath('alpha', session.id, decision.id), body)
}

async function finish(p: AcpPlatform, session: AgentSession, act: () => unknown): Promise<AgentSessionEvent[]> {
  const done = waitFor(p.sessions, session.id, 'turn_end')
  await act()
  await done
  return p.sessions.events(session.id)
}

const toolStatus = (events: AgentSessionEvent[]) => events.flatMap(event => (event.kind === 'tool_result' ? [event.update.status] : []))
const agentText = (events: AgentSessionEvent[]) => events.flatMap(event => (event.kind === 'text' ? [event.text] : []))

describe('pending decisions', () => {
  it('streams a permission request as a pending decision after the request row', async () => {
    const { p, session } = await boot()
    const res = await appOf(p).request(sessionEventsPath('alpha', session.id))
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const decision = await promptForDecision(p, session, 'guarded-tool')
    let text = ''
    while (!/decision_opened[^\n]*\n(?:[^\n]+\n)*\n/.test(text)) text += decoder.decode((await reader.read()).value, { stream: true })
    await reader.cancel()
    const frames = text.slice(0, text.lastIndexOf('\n\n')).split('\n\n').map(frame => frame.split('\n'))
    const rows = frames.filter(lines => lines.includes('event: session')).map(lines => JSON.parse(lines.find(line => line.startsWith('data: '))!.slice(6)) as AgentSessionEvent)
    const kinds = rows.map(row => row.kind)
    expect(kinds.indexOf('permission_request')).toBeLessThan(kinds.indexOf('decision_opened'))
    expect(rows.map(row => row.seq)).toEqual([...rows.map(row => row.seq)].sort((a, b) => a - b))

    expect(decision).toMatchObject({ sessionId: session.id, kind: 'permission', state: 'pending', toolCall: { toolCallId: 'call-3' }, answer: null })
    expect(decision.options).toEqual([
      { kind: 'allow_once', optionId: 'once', label: 'Allow once', meta: null },
      { kind: 'deny', optionId: 'no', label: 'Deny', meta: null },
    ])
    expect(Date.parse(decision.expiresAt) - Date.parse(decision.createdAt)).toBe(300_000)
    const listed = (await (await call(p, 'GET', sessionDecisionsPath('alpha', session.id))).json()) as DecisionListResponse
    expect(listed.decisions).toEqual([decision])
    await finish(p, session, () => answer(p, session, decision, { optionKind: 'deny' }))
  })

  it('stops the tool on deny and logs who answered', async () => {
    const { p, session } = await boot()
    const decision = await promptForDecision(p, session, 'guarded-tool')
    let response: Response | undefined
    const events = await finish(p, session, async () => { response = await answer(p, session, decision, { optionKind: 'deny', explanation: 'not in this repo' }) })
    expect(response!.status).toBe(200)
    const answered = ((await response!.json()) as DecisionResponse).decision
    expect(answered).toMatchObject({ state: 'answered', answer: { optionKind: 'deny', optionId: 'no', surface: 'web', actorId: expect.any(String), explanation: 'not in this repo' } })
    expect(toolStatus(events)).toEqual(['failed'])
    expect(agentText(events)).toEqual(['skipped:{"outcome":"selected","optionId":"no"}'])
    expect(events.find(event => event.kind === 'decision_answered')).toMatchObject({ decisionId: decision.id, answer: { optionKind: 'deny', surface: 'web' } })
  })

  it('continues the tool on allow and rejects a second answer from any surface', async () => {
    const { p, session } = await boot()
    const decision = await promptForDecision(p, session, 'guarded-tool')
    const events = await finish(p, session, async () => expect((await answer(p, session, decision, { optionKind: 'allow_once' })).status).toBe(200))
    expect(toolStatus(events)).toEqual(['completed'])
    expect(agentText(events)).toEqual(['ran:once'])

    expect(await errorOf(await answer(p, session, decision, { optionKind: 'deny' }))).toEqual({ status: 409, code: 'already_answered' })
    expect(() => p.decisions.answer(decision.id, { optionKind: 'allow_once', surface: 'slack', actorId: 'U123' })).toThrow(DecisionError)
    expect(p.sessions.events(session.id).filter(event => event.kind === 'decision_answered')).toHaveLength(1)
    expect((await (await call(p, 'GET', sessionDecisionsPath('alpha', session.id))).json() as DecisionListResponse).decisions[0]).toMatchObject({ state: 'answered', answer: { surface: 'web', optionKind: 'allow_once' } })
  })

  it('lets the first surface win when two answer the same decision', async () => {
    const { p, session } = await boot()
    const decision = await promptForDecision(p, session, 'guarded-tool')
    const done = waitFor(p.sessions, session.id, 'turn_end')
    const first = p.decisions.answer(decision.id, { optionKind: 'allow_once', surface: 'slack', actorId: 'U123' })
    expect(first.answer).toMatchObject({ surface: 'slack', actorId: 'U123' })
    expect(await errorOf(await answer(p, session, decision, { optionKind: 'deny' }))).toEqual({ status: 409, code: 'already_answered' })
    await done
    expect(toolStatus(p.sessions.events(session.id))).toEqual(['completed'])
  })

  it('refuses a decision nobody answers in time', async () => {
    const { p, session } = await boot({ decisions: { timeoutMs: 300 } })
    const decision = await promptForDecision(p, session, 'guarded-tool')
    const done = waitFor(p.sessions, session.id, 'turn_end')
    await done
    const events = p.sessions.events(session.id)
    expect(events.find(event => event.kind === 'decision_expired')).toMatchObject({ decisionId: decision.id, expiry: { reason: 'timeout' } })
    expect(toolStatus(events)).toEqual(['failed'])
    expect(agentText(events)).toEqual(['skipped:{"outcome":"cancelled"}'])
    expect(await errorOf(await answer(p, session, decision, { optionKind: 'allow_once' }))).toEqual({ status: 409, code: 'decision_expired' })
  })

  it('refuses an answer that arrives after the deadline on an injected clock', async () => {
    let clock = Date.parse('2026-10-28T00:00:00Z')
    const { p, session } = await boot({ decisions: { timeoutMs: 60_000, now: () => clock } })
    const decision = await promptForDecision(p, session, 'guarded-tool')
    clock += 60_000
    const events = await finish(p, session, async () => expect(await errorOf(await answer(p, session, decision, { optionKind: 'allow_once' }))).toEqual({ status: 409, code: 'decision_expired' }))
    expect(toolStatus(events)).toEqual(['failed'])
    expect(events.find(event => event.kind === 'decision_expired')).toMatchObject({ expiry: { reason: 'timeout', at: '2026-10-28T00:01:00.000Z' } })
  })

  it('answers by kind, never by position, and always-allows only rules the agent proposed', async () => {
    const { p, session } = await boot()
    const plain = await promptForDecision(p, session, 'guarded-tool')
    expect(await errorOf(await answer(p, session, plain, { optionKind: 'allow_always' }))).toEqual({ status: 422, code: 'option_not_offered' })
    expect(await errorOf(await answer(p, session, plain, { optionIndex: 0 }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await answer(p, session, plain, { optionKind: 'yes' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await answer(p, session, plain, { optionKind: 'allow_once', optionId: 'no' }))).toEqual({ status: 422, code: 'option_not_offered' })
    expect(await errorOf(await answer(p, session, plain, { optionKind: 'answer' }))).toEqual({ status: 422, code: 'option_not_offered' })
    expect(p.decisions.get(plain.id)?.state).toBe('pending')
    await finish(p, session, () => answer(p, session, plain, { optionKind: 'deny' }))

    const rules = await promptForDecision(p, session, 'guarded-rules')
    expect(rules.options.map(option => [option.kind, option.optionId])).toEqual([['allow_once', 'once'], ['allow_always', 'rule-0'], ['allow_always', 'rule-1'], ['deny', 'no']])
    expect(rules.options[1]!.meta).toEqual({ rule: 'Edit(scratch.txt)' })
    expect(await errorOf(await answer(p, session, rules, { optionKind: 'allow_always' }))).toEqual({ status: 400, code: 'invalid_request' })
    expect(await errorOf(await answer(p, session, rules, { optionKind: 'allow_once', optionId: 'review' }))).toEqual({ status: 422, code: 'option_not_offered' })
    const events = await finish(p, session, async () => expect((await answer(p, session, rules, { optionKind: 'allow_always', optionId: 'rule-0' })).status).toBe(200))
    expect(agentText(events).at(-1)).toBe('ran:rule-0')
  })

  it('checks a question answer against its form and declines on deny', async () => {
    const { p, session } = await boot()
    const question = await promptForDecision(p, session, 'question')
    expect(question).toMatchObject({ kind: 'question', toolCall: null, request: { message: 'Which formatter?' } })
    expect(question.options.map(option => option.kind)).toEqual(['answer', 'deny'])
    expect(await errorOf(await answer(p, session, question, { optionKind: 'answer', answer: { formatter: 'eslint' } }))).toEqual({ status: 422, code: 'invalid_answer' })
    expect(await errorOf(await answer(p, session, question, { optionKind: 'answer', answer: { formatter: 'prettier', extra: 1 } }))).toEqual({ status: 422, code: 'invalid_answer' })
    expect(await errorOf(await answer(p, session, question, { optionKind: 'allow_once' }))).toEqual({ status: 422, code: 'option_not_offered' })
    let events = await finish(p, session, async () => expect((await answer(p, session, question, { optionKind: 'answer', answer: { formatter: 'prettier' } })).status).toBe(200))
    expect(agentText(events).at(-1)).toBe('question:{"action":"accept","content":{"formatter":"prettier"}}')

    const second = await promptForDecision(p, session, 'question')
    events = await finish(p, session, () => answer(p, session, second, { optionKind: 'deny' }))
    expect(agentText(events).at(-1)).toBe('question:{"action":"decline"}')
  })

  it('expires a decision whose turn is cancelled and 404s an unknown one', async () => {
    const { p, session } = await boot()
    const decision = await promptForDecision(p, session, 'guarded-tool')
    await call(p, 'POST', sessionCancelPath('alpha', session.id))
    expect(p.sessions.events(session.id).find(event => event.kind === 'decision_expired')).toMatchObject({ decisionId: decision.id, expiry: { reason: 'cancelled' } })
    expect(await errorOf(await answer(p, session, decision, { optionKind: 'allow_once' }))).toEqual({ status: 409, code: 'decision_expired' })
    expect(await errorOf(await answer(p, session, { ...decision, id: 'nope' }, { optionKind: 'deny' }))).toEqual({ status: 404, code: 'not_found' })
  })

  it('reads decisions back from the log after a restart', async () => {
    const { p, session } = await boot()
    const decision = await promptForDecision(p, session, 'guarded-tool')
    await finish(p, session, () => answer(p, session, decision, { optionKind: 'allow_once' }))
    await p.sessions.close()
    p.close()
    const again = startAcpPlatform(temp!.root, { acp: { bins: fakeBins, killTimeoutMs: 1000 } })
    platform = again
    const listed = (await (await call(again, 'GET', sessionDecisionsPath('alpha', session.id))).json()) as DecisionListResponse
    expect(listed.decisions).toMatchObject([{ id: decision.id, state: 'answered', answer: { optionKind: 'allow_once', surface: 'web' } }])
    expect(await errorOf(await answer(again, session, decision, { optionKind: 'deny' }))).toEqual({ status: 409, code: 'already_answered' })
  })
})

describe('never-bypass at session creation', () => {
  it('refuses a Claude Code session whose posture carries a bypass mode', async () => {
    const { p, session } = await boot()
    healthyPlugin(p, session.projectId, 'claude-code')
    for (const flags of [['--dangerously-skip-permissions'], ['--permission-mode', 'bypassPermissions'], ['--allowedTools', 'Bash']]) {
      const res = await call(p, 'POST', projectSessionsPath('alpha'), { family: 'claude-code', posture: { flags } })
      expect(await errorOf(res)).toEqual({ status: 400, code: 'invalid_request' })
    }
    expect(((await (await call(p, 'GET', projectSessionsPath('alpha'))).json()) as SessionListResponse).sessions).toHaveLength(1)
    expect((await call(p, 'POST', projectSessionsPath('alpha'), { family: 'claude-code', posture: { flags: ['--permission-mode', 'plan'] } })).status).toBe(201)
  })
})

describe('decision settings', () => {
  it('parses CM_DECISION_TIMEOUT', () => {
    expect(resolveDecisionSettings({})).toEqual({ timeoutMs: 300_000 })
    expect(resolveDecisionSettings({ CM_DECISION_TIMEOUT: '90s' })).toEqual({ timeoutMs: 90_000 })
    expect(() => resolveDecisionSettings({ CM_DECISION_TIMEOUT: '0s' })).toThrow(/CM_DECISION_TIMEOUT/)
    expect(() => resolveDecisionSettings({ CM_DECISION_TIMEOUT: '2d' })).toThrow(/at most 1d/)
  })
})
