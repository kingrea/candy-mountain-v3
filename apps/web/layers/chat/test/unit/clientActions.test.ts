import type { AgentSessionEvent, PlatformClientAction, RegistryResponse } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  chatActionLabel,
  chatActionLedger,
  chatActionsToApply,
  chatActionState,
  chatNavigatePath,
  type ChatActionLedger,
} from '../../app/utils/chatClientActions'
import { chatSegmentTranscript, chatTranscriptRows } from '../../app/utils/chatTranscript'

const navigate: PlatformClientAction = { kind: 'navigate', to: '/p/alpha/uptime', projectSlug: 'alpha', viewId: 'uptime', capabilityId: 'uptime' }
const openThread: PlatformClientAction = { kind: 'open_thread', agentId: 'scribe' }

const at = (second: number) => `2026-10-28T10:00:${String(second).padStart(2, '0')}.000Z`

function row(seq: number, toolCallId: string, action: PlatformClientAction): AgentSessionEvent {
  return { seq, at: at(seq), kind: 'client_action', toolCallId, action }
}

const registry = {
  project: { id: 'p1', slug: 'alpha', name: 'Alpha' },
  views: [{ id: 'uptime', capabilityId: 'uptime', label: 'Uptime', icon: 'i-lucide-activity', path: 'uptime', to: '/p/alpha/uptime/checks', ready: true }],
  agents: [{ id: 'scribe', capabilityId: 'chat-scribe', label: 'Scribe', description: '' }],
} as unknown as RegistryResponse

describe('client action transcript items', () => {
  it('shows each action as its own item after its tool call, tagged with its session', () => {
    const items = chatSegmentTranscript(chatTranscriptRows([
      { id: 'old', divider: null, events: [row(1, 'c1', navigate)] },
      { id: 'current', divider: null, events: [
        { seq: 1, at: at(1), kind: 'tool_call', toolCall: { toolCallId: 'c1', title: 'Open view', status: 'in_progress' } },
        { seq: 2, at: at(2), kind: 'tool_result', update: { toolCallId: 'c1', status: 'completed' } },
        row(3, 'c1', openThread),
        { seq: 4, at: at(4), kind: 'text', role: 'agent', text: 'Done.' },
      ] },
    ]))
    expect(items.map(item => item.kind)).toEqual(['action', 'tool', 'action', 'text'])
    expect(items[0]).toMatchObject({ session: 'old', toolCallId: 'c1', action: navigate, key: 'old:1' })
    expect(items[2]).toMatchObject({ session: 'current', toolCallId: 'c1', action: openThread, key: 'current:3' })
  })

  it('drops an action of a kind the browser does not know', () => {
    const odd = { seq: 1, at: at(1), kind: 'client_action', toolCallId: 'c1', action: { kind: 'delete_everything' } } as unknown as AgentSessionEvent
    expect(chatSegmentTranscript([odd])).toEqual([])
  })
})

describe('chatActionsToApply', () => {
  const ledger = (since: number, outcomes: ChatActionLedger['outcomes'] = {}): ChatActionLedger => ({ since: at(since), outcomes })

  it('applies only platform-thread actions newer than the ledger start, once per tool call', () => {
    const rows = [row(1, 'old', navigate), row(3, 'c1', navigate), row(4, 'c1', navigate), row(5, 'c2', openThread)]
    expect(chatActionsToApply(rows, ledger(2), 'platform')).toEqual([
      { toolCallId: 'c1', action: navigate },
      { toolCallId: 'c2', action: openThread },
    ])
  })

  it('skips tool calls already taken, so a replayed stream applies nothing again', () => {
    const rows = [row(3, 'c1', navigate), row(5, 'c2', openThread)]
    expect(chatActionsToApply(rows, ledger(2, { c1: { state: 'applied' }, c2: { state: 'applying' } }), 'platform')).toEqual([])
  })

  it('treats rows up to the session activity at first sight as replay after a reload', () => {
    const rows = [row(3, 'c1', navigate), row(5, 'c2', openThread)]
    expect(chatActionsToApply(rows, chatActionLedger({ lastActivityAt: at(5) }), 'platform')).toEqual([])
  })

  it('never applies actions in another agent\'s thread or before the session is followed', () => {
    const rows = [row(3, 'c1', navigate)]
    expect(chatActionsToApply(rows, ledger(0), 'scribe')).toEqual([])
    expect(chatActionsToApply(rows, ledger(0), null)).toEqual([])
    expect(chatActionsToApply(rows, undefined, 'platform')).toEqual([])
  })
})

describe('chatActionState', () => {
  it('marks other agents\' actions ignored and untaken platform actions as earlier', () => {
    const ledger: ChatActionLedger = { since: at(0), outcomes: { c1: { state: 'applied' }, c2: { state: 'failed', message: 'nope' } } }
    expect(chatActionState('c1', ledger, false)).toBe('ignored')
    expect(chatActionState('c1', ledger, true)).toBe('applied')
    expect(chatActionState('c2', ledger, true)).toBe('failed')
    expect(chatActionState('c3', ledger, true)).toBe('earlier')
  })
})

describe('chatNavigatePath and chatActionLabel', () => {
  it('prefers the registry route for the same project and falls back to the action route', () => {
    expect(chatNavigatePath(navigate, registry)).toBe('/p/alpha/uptime/checks')
    expect(chatNavigatePath({ ...navigate, viewId: 'gone' }, registry)).toBe('/p/alpha/uptime')
    expect(chatNavigatePath({ ...navigate, projectSlug: 'beta', to: '/p/beta/uptime' }, registry)).toBe('/p/beta/uptime')
    expect(chatNavigatePath(navigate, null)).toBe('/p/alpha/uptime')
  })

  it('names the view, project and agent from the registry', () => {
    expect(chatActionLabel(navigate, 'applied', registry)).toBe('Opened Uptime for Alpha')
    expect(chatActionLabel(navigate, 'ignored', registry)).toBe('Did not open Uptime for Alpha')
    expect(chatActionLabel({ ...navigate, projectSlug: 'beta' }, 'earlier', registry)).toBe('Opened uptime for beta')
    expect(chatActionLabel(openThread, 'applied', registry)).toBe('Started a chat with Scribe')
    expect(chatActionLabel({ kind: 'open_thread', agentId: 'oracle' }, 'failed', registry)).toBe('Could not start a chat with oracle')
  })
})
