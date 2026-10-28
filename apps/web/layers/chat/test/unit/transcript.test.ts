import type { AgentSessionEvent } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { chatRenderMarkdown } from '../../app/utils/chatMarkdown'
import { decision } from './fixtures'
import { chatDecisionTool, chatSegmentTranscript, chatStopReasonLabel, chatTranscriptRows, chatUsageParts, type ChatTranscriptItem } from '../../app/utils/chatTranscript'

type Payload = AgentSessionEvent extends infer E ? E extends AgentSessionEvent ? Omit<E, 'seq' | 'at'> : never : never

function log(...payloads: Payload[]): AgentSessionEvent[] {
  return payloads.map((payload, index) => ({ seq: index + 1, at: `2026-10-28T10:00:${String(index).padStart(2, '0')}.000Z`, ...payload }) as AgentSessionEvent)
}

const kinds = (items: ChatTranscriptItem[]) => items.map(item => item.kind)

describe('chatSegmentTranscript', () => {
  it('joins streamed chunks of one kind until something else arrives', () => {
    const items = chatSegmentTranscript(log(
      { kind: 'prompt', text: 'hi' },
      { kind: 'reasoning', text: 'Let me ' },
      { kind: 'reasoning', text: 'think.' },
      { kind: 'text', role: 'agent', text: 'Hello **wor' },
      { kind: 'text', role: 'agent', text: 'ld**' },
      { kind: 'tool_call', toolCall: { toolCallId: 'c1', title: 'ls', kind: 'execute', status: 'in_progress' } },
      { kind: 'text', role: 'agent', text: 'after' },
    ))
    expect(kinds(items)).toEqual(['prompt', 'reasoning', 'text', 'tool', 'text'])
    expect(items[1]).toMatchObject({ text: 'Let me think.', key: '2', endedAt: '2026-10-28T10:00:03.000Z' })
    expect(items[2]).toMatchObject({ text: 'Hello **world**', key: '4' })
    expect(items[4]).toMatchObject({ text: 'after' })
  })

  it('shows replayed user text as a prompt', () => {
    const items = chatSegmentTranscript(log({ kind: 'text', role: 'user', text: 'earlier ' }, { kind: 'text', role: 'user', text: 'prompt' }))
    expect(items).toEqual([expect.objectContaining({ kind: 'prompt', text: 'earlier prompt' })])
  })

  it('folds a tool call and its results into one item that settles at turn end', () => {
    const items = chatSegmentTranscript(log(
      { kind: 'tool_call', toolCall: { toolCallId: 'c1', title: 'Bash: ls', kind: 'execute', status: 'in_progress', rawInput: { command: 'ls' } } },
      { kind: 'tool_result', update: { toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'a\nb' } }], rawOutput: 'a\nb' } },
      { kind: 'tool_call', toolCall: { toolCallId: 'c2', title: 'Edit', kind: 'edit', status: 'pending' } },
      { kind: 'tool_result', update: { toolCallId: 'c2', content: [{ type: 'diff', path: '/x.ts', oldText: 'a', newText: 'b' }] } },
    ))
    expect(kinds(items)).toEqual(['tool', 'tool'])
    expect(items[0]).toMatchObject({ toolCallId: 'c1', title: 'Bash: ls', status: 'completed', running: false, input: { command: 'ls' }, output: [{ type: 'text', text: 'a\nb' }] })
    expect(items[1]).toMatchObject({ status: 'pending', running: true, output: [{ type: 'diff', path: '/x.ts', oldText: 'a', newText: 'b' }] })

    const ended = chatSegmentTranscript([...log(
      { kind: 'tool_call', toolCall: { toolCallId: 'c1', title: 'ls', status: 'in_progress' } },
    ), { seq: 2, at: 'z', kind: 'turn_end', stopReason: 'cancelled', usage: null }])
    expect(ended[0]).toMatchObject({ status: 'in_progress', running: false })
  })

  it('creates the tool item from a result that arrived without its call', () => {
    const items = chatSegmentTranscript(log({ kind: 'tool_result', update: { toolCallId: 'c9', status: 'failed', title: 'Read' } }))
    expect(items).toEqual([expect.objectContaining({ kind: 'tool', toolCallId: 'c9', status: 'failed', title: 'Read', running: false })])
  })

  it('carries each decision at its latest state and hides the raw request rows', () => {
    const opened = decision()
    const items = chatSegmentTranscript(log(
      { kind: 'permission_request', requestId: 'r1', toolCall: {}, options: [] },
      { kind: 'decision_opened', decision: opened },
      { kind: 'decision_answered', decisionId: 'd1', answer: { optionKind: 'deny', optionId: 'reject-once', answer: null, explanation: null, surface: 'web', actorId: 'a1', at: 'now' } },
      { kind: 'decision_opened', decision: decision({ id: 'd2', requestId: 'r2' }) },
      { kind: 'request_cancelled', requestId: 'r2' },
      { kind: 'decision_expired', decisionId: 'd2', expiry: { reason: 'timeout', message: 'Nobody answered in time, so the agent was refused.', at: 'now' } },
    ))
    expect(kinds(items)).toEqual(['decision', 'decision'])
    expect(items[0]).toMatchObject({ key: '2', decision: { id: 'd1', state: 'answered', answer: { optionKind: 'deny' } } })
    expect(items[1]).toMatchObject({ decision: { id: 'd2', state: 'expired', expiry: { reason: 'timeout' } } })
    expect(opened.state).toBe('pending')
  })

  it('puts the turn usage on its end marker and reports failures', () => {
    const items = chatSegmentTranscript(log(
      { kind: 'usage', usage: { used: 1200, size: 200000 } },
      { kind: 'usage', usage: { used: 1500, size: 200000, cost: { amount: 0.0123, currency: 'USD' } } },
      { kind: 'turn_end', stopReason: 'end_turn', usage: { totalTokens: 12, inputTokens: 10, outputTokens: 2 } },
      { kind: 'turn_end', stopReason: 'cancelled', usage: null },
      { kind: 'error', phase: 'start', message: 'boom', code: null },
      { kind: 'auth_required', message: 'log in' },
      { kind: 'exited', code: 0, signal: null, expected: true },
      { kind: 'exited', code: 3, signal: null, expected: false },
      { kind: 'other', update: { sessionUpdate: 'current_mode_update' } },
    ))
    expect(kinds(items)).toEqual(['turn', 'turn', 'error', 'error', 'error'])
    expect(items[0]).toMatchObject({ stopReason: 'end_turn', usage: { tokens: { input: 10, output: 2, total: 12 }, context: { used: 1500, size: 200000 }, cost: { amount: 0.0123, currency: 'USD' } } })
    expect(items[1]).toMatchObject({ stopReason: 'cancelled', usage: null })
    expect(items.slice(2).map(item => item.kind === 'error' && item.title)).toEqual(['The agent could not start', 'The agent is not logged in', 'The agent stopped unexpectedly'])
  })

  it('restarts seqs and tool ids after a divider and keys the current session stably', () => {
    const earlier = log({ kind: 'prompt', text: 'one' }, { kind: 'tool_call', toolCall: { toolCallId: 'c1', title: 'ls', status: 'completed' } })
    const current = log({ kind: 'prompt', text: 'two' }, { kind: 'tool_call', toolCall: { toolCallId: 'c1', title: 'cat', status: 'in_progress' } })
    const items = chatSegmentTranscript(chatTranscriptRows([
      { id: 's1', divider: null, events: earlier },
      { id: 'current', divider: 'New session with model Opus', events: current },
    ]))
    expect(kinds(items)).toEqual(['prompt', 'tool', 'divider', 'prompt', 'tool'])
    expect(items.map(item => item.key)).toEqual(['s1:1', 's1:2', 'current:divider', 'current:1', 'current:2'])
    expect(items[1]).toMatchObject({ title: 'ls', running: false })
    expect(items[4]).toMatchObject({ title: 'cat', running: true })

    const alone = chatSegmentTranscript(chatTranscriptRows([{ id: 'current', divider: null, events: current }]))
    expect(alone.map(item => item.key)).toEqual(['current:1', 'current:2'])
  })
})

describe('transcript formatting', () => {
  it('summarises usage and stop reasons', () => {
    expect(chatUsageParts({ tokens: { input: 1234, output: 56, total: 1290, thought: null, cachedRead: null, cachedWrite: null }, context: { used: 1500, size: 200000 }, cost: { amount: 0.5, currency: 'USD' } }))
      .toEqual(['1.2K in', '56 out', '1.5K / 200K context', '$0.50'])
    expect(chatUsageParts({ tokens: null, context: null, cost: { amount: 1, currency: 'not-a-code' } })).toEqual(['1 not-a-code'])
    expect(chatStopReasonLabel('end_turn')).toBe('Done')
    expect(chatStopReasonLabel('weird')).toBe('Stopped (weird)')
  })

  it('reads the gated tool call off a decision', () => {
    expect(chatDecisionTool(decision({ toolCall: { title: 'Bash: rm', kind: 'execute', rawInput: { command: 'rm x' }, content: [{ type: 'content', content: { type: 'text', text: 'outside the checkout' } }], locations: [{ path: '/x' }] } })))
      .toEqual({ title: 'Bash: rm', kind: 'execute', input: { command: 'rm x' }, notes: ['outside the checkout'], locations: ['/x'] })
    expect(chatDecisionTool(decision({ toolCall: null }))).toMatchObject({ title: 'Tool call', notes: [] })
  })

  it('renders agent markdown with raw HTML escaped and unsafe links dropped', () => {
    const html = chatRenderMarkdown('**bold** <img src=x onerror="alert(1)"> [x](javascript:alert(1)) [ok](https://example.com)')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).not.toMatch(/<img|href="javascript/i)
    expect(html).toContain('&lt;img')
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">ok</a>')
  })
})
