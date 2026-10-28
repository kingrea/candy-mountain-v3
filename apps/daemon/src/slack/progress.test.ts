import type { AgentSessionEvent } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { createSlackClient } from '../plugins/slack'
import { createSlackProgress, SLACK_STREAM_MAX_AGE_MS, SLACK_STREAM_TEXT_MAX, type SlackProgressOptions, type SlackTurnMessage } from './progress'

interface SlackCall { method: string, body: Record<string, unknown> }

/** Answers each method with `errors[method]` while it has one left, else ok with a fresh ts. */
function recorder(errors: Record<string, string[]> = {}) {
  const calls: SlackCall[] = []
  let posted = 0
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const method = String(url).replace('https://slack.com/api/', '')
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ method, body })
    const error = errors[method]?.shift()
    const reply = error ? { ok: false, error } : { ok: true, ts: `9.${++posted}` }
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { client: createSlackClient('xoxb-test', { fetch }), calls, methods: () => calls.map(call => call.method) }
}

const target = { channel: 'C1', threadTs: '1.1', recipientUserId: 'U1', recipientTeamId: 'T1' }
const at = new Date(0).toISOString()
const text = (seq: number, value: string): AgentSessionEvent => ({ seq, at, kind: 'text', role: 'agent', text: value }) as AgentSessionEvent
const tool = (seq: number, status: string): AgentSessionEvent => ({ seq, at, kind: 'tool_call', toolCall: { toolCallId: 't1', title: 'Read file', status } }) as AgentSessionEvent
const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))

function progress(client: ReturnType<typeof recorder>['client'], options: Partial<SlackProgressOptions> = {}) {
  const messages: SlackTurnMessage[] = []
  const sent: number[] = []
  const errors: unknown[] = []
  const p = createSlackProgress(client, target, { intervalMs: 5, native: true, log: { error: (...args: unknown[]) => void errors.push(args) }, onMessage: m => void messages.push(m), onSent: s => void sent.push(s), ...options })
  return { p, messages, sent, errors }
}

describe('Slack turn progress', () => {
  it('posts nothing for a turn with nothing to say', async () => {
    const slack = recorder()
    const { p } = progress(slack.client)
    expect(await p.finish()).toBeNull()
    expect(slack.calls).toEqual([])
  })

  it('carries a stream past Slack\'s age limit on as edits of the same message', async () => {
    const slack = recorder()
    let clock = 0
    const { p, messages } = progress(slack.client, { now: () => clock })
    p.push(text(2, 'one '))
    await tick()
    clock = SLACK_STREAM_MAX_AGE_MS
    p.push(tool(3, 'in_progress'))
    await tick()
    p.push(text(4, 'two'))
    await p.finish()
    expect(slack.methods()).toEqual(['chat.startStream', 'chat.stopStream', 'chat.update', 'chat.update'])
    expect(slack.calls.slice(1).every(call => call.body.ts === '9.1')).toBe(true)
    expect(slack.calls.at(-1)!.body.text).toBe('… Read file\n\none two')
    expect(messages.map(m => m.mode)).toEqual(['stream', 'message'])
  })

  it('leaves the stream before passing Slack\'s length limit', async () => {
    const slack = recorder()
    const { p, messages } = progress(slack.client)
    p.push(text(2, 'a'.repeat(SLACK_STREAM_TEXT_MAX - 10)))
    await tick()
    p.push(text(3, 'b'.repeat(20)))
    await p.finish()
    expect(slack.methods().slice(0, 3)).toEqual(['chat.startStream', 'chat.stopStream', 'chat.update'])
    expect(slack.calls.filter(call => call.method === 'chat.postMessage').length).toBeGreaterThan(0)
    expect(messages.map(m => m.mode)).toEqual(['stream', 'message'])
  })

  it('stops calling Slack once the member stops the stream', async () => {
    const slack = recorder({ 'chat.appendStream': ['stopped_by_user'] })
    const { p } = progress(slack.client)
    p.push(text(2, 'one'))
    await tick()
    p.push(text(3, 'two'))
    await tick()
    p.push(text(4, 'three'))
    expect(await p.finish()).toMatchObject({ ts: '9.1', mode: 'stream' })
    expect(slack.methods()).toEqual(['chat.startStream', 'chat.appendStream'])
  })

  it('keeps streaming when chat.startStream fails for a reason a post would share', async () => {
    const slack = recorder({ 'chat.startStream': ['not_in_channel'] })
    const refused: boolean[] = []
    const { p, errors } = progress(slack.client, { onNativeRefused: () => void refused.push(true) })
    p.push(text(2, 'one'))
    await tick()
    expect(errors).toHaveLength(1)
    p.push(text(3, ' two'))
    await tick()
    await p.finish()
    expect(refused).toEqual([])
    expect(slack.methods()).toEqual(['chat.startStream', 'chat.startStream', 'chat.stopStream'])
    expect(slack.calls[1]!.body.chunks).toEqual([{ type: 'markdown_text', text: 'one two' }])
  })

  it('throttles updates to one call per interval', async () => {
    const slack = recorder({ 'chat.startStream': ['unknown_method'] })
    const { p, sent } = progress(slack.client, { intervalMs: 50 })
    p.push(text(2, 'a'))
    await tick(20)
    for (let seq = 3; seq < 13; seq++) p.push(text(seq, 'b'))
    await tick(120)
    await p.finish()
    expect(slack.methods()).toEqual(['chat.startStream', 'chat.postMessage', 'chat.update', 'chat.update'])
    expect(slack.calls.at(-1)!.body.text).toBe(`a${'b'.repeat(10)}`)
    expect(sent.at(-1)).toBe(12)
  })

  it('sends only what Slack has not seen when it resumes a turn', async () => {
    const slack = recorder()
    const history = [text(2, 'seen '), tool(3, 'completed'), text(4, 'unseen')]
    const { p } = progress(slack.client, { message: { channel: 'C1', threadTs: '1.1', ts: '5.5', mode: 'stream' }, openedAt: 0, now: () => 1000, sentSeq: 3, history })
    expect(p.text).toBe('seen unseen')
    await p.finish('_Stopped._')
    expect(slack.calls).toEqual([{ method: 'chat.stopStream', body: { channel: 'C1', ts: '5.5', chunks: [{ type: 'markdown_text', text: 'unseen' }, { type: 'markdown_text', text: '\n\n_Stopped._' }] } }])
  })
})
