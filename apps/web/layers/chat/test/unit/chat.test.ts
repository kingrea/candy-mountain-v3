import type { ChatThread, RegistryAgent } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { chatIsWorking } from '../../app/utils/chatEvents'
import { chatThreadLink, CHAT_THREAD_QUERY } from '../../app/utils/chatLinks'
import { chatAgentRailEntries, chatRailRegister, chatRailSources } from '../../app/utils/chatRail'
import { chatRelativeTime } from '../../app/utils/chatTime'

const agent = (id: string, extra: Partial<RegistryAgent> = {}): RegistryAgent => ({ id, capabilityId: 'chat-claude-code', label: id, description: '', ...extra })

function thread(agentId: string, flags: Partial<ChatThread> = {}): ChatThread {
  return {
    id: `${agentId}-thread`, projectId: 'p1', actorId: 'a1', agentId, currentSessionId: 's1', title: null, model: null, effort: null,
    unread: false, working: false, lastReadAt: null, lastActivityAt: '2026-10-28T10:00:00.000Z', createdAt: '2026-10-28T10:00:00.000Z', updatedAt: '2026-10-28T10:00:00.000Z',
    ...flags,
  }
}

describe('chatAgentRailEntries', () => {
  it('maps registry agents with flags folded from their threads', () => {
    const entries = chatAgentRailEntries(
      [agent('claude-code', { label: 'Claude Code', avatar: 'i-lucide-sparkles' }), agent('codex')],
      [thread('claude-code', { unread: true }), thread('claude-code', { id: 't2', working: true }), thread('codex')],
    )
    expect(entries).toEqual([
      expect.objectContaining({ id: 'claude-code', label: 'Claude Code', avatar: 'i-lucide-sparkles', agentId: 'claude-code', unread: true, working: true }),
      expect.objectContaining({ id: 'codex', avatar: 'i-lucide-bot', unread: false, working: false }),
    ])
  })

  it('orders registered sources after the agents by their order', () => {
    chatRailRegister({ id: 'late', order: 200, use: () => [] })
    chatRailRegister({ id: 'early', use: () => [] })
    expect(chatRailSources().map(source => source.id)).toEqual(['early', 'late'])
  })
})

describe('chatIsWorking', () => {
  it('treats queued, starting and prompting as working', () => {
    expect(['queued', 'starting', 'prompting'].map(status => chatIsWorking(status as never))).toEqual([true, true, true])
    expect(['idle', 'live', null, undefined].map(status => chatIsWorking(status as never))).toEqual([false, false, false, false])
  })
})

describe('chatThreadLink', () => {
  it('builds the deep link on the current page or a given one', () => {
    expect(chatThreadLink('t1')).toEqual({ query: { [CHAT_THREAD_QUERY]: 't1' } })
    expect(chatThreadLink('t1', '/p/acme')).toEqual({ path: '/p/acme', query: { thread: 't1' } })
  })
})

describe('chatRelativeTime', () => {
  const now = Date.parse('2026-10-28T12:00:00.000Z')

  it('rounds to the largest unit that fits', () => {
    expect(chatRelativeTime('2026-10-28T11:59:40.000Z', now)).toBe('just now')
    expect(chatRelativeTime('2026-10-28T11:35:00.000Z', now)).toBe('25 minutes ago')
    expect(chatRelativeTime('2026-10-28T09:00:00.000Z', now)).toBe('3 hours ago')
    expect(chatRelativeTime('2026-10-26T12:00:00.000Z', now)).toBe('2 days ago')
    expect(chatRelativeTime('nope', now)).toBe('')
  })
})
