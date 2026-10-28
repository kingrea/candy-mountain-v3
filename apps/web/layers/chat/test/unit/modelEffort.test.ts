import type { ChatAgentOptions, ChatThreadSession } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { CHAT_OPTION_DEFAULT, chatAgentHasOptions, chatOptionChoice, chatOptionItems, chatOptionValue, chatSessionDividers } from '../../app/utils/chatModelEffort'

const claude: ChatAgentOptions = {
  agentId: 'claude-code',
  family: 'claude-code',
  models: [{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }],
  efforts: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
}

const session = (sessionId: string, model: string | null, effort: string | null): ChatThreadSession => ({ sessionId, model, effort, createdAt: '2026-10-28T10:00:00.000Z' })

describe('model and effort options', () => {
  it('leads the items with the agent default and round-trips it as null', () => {
    expect(chatOptionItems(claude.models, 'Default model')).toEqual([
      { label: 'Default model', value: CHAT_OPTION_DEFAULT },
      { label: 'Opus', value: 'opus' },
      { label: 'Sonnet', value: 'sonnet' },
    ])
    expect(chatOptionValue(null)).toBe(CHAT_OPTION_DEFAULT)
    expect(chatOptionChoice(CHAT_OPTION_DEFAULT)).toBeNull()
    expect(chatOptionChoice('opus')).toBe('opus')
  })

  it('reports no options for an agent with empty lists', () => {
    expect(chatAgentHasOptions(claude)).toBe(true)
    expect(chatAgentHasOptions({ agentId: 'codex', family: 'codex', models: [], efforts: [] })).toBe(false)
    expect(chatAgentHasOptions(null)).toBe(false)
  })

  it('words a divider for every session that replaced another', () => {
    const dividers = chatSessionDividers([
      session('s1', null, null),
      session('s2', 'sonnet', null),
      session('s3', 'sonnet', 'high'),
      session('s4', null, 'low'),
      session('s5', 'claude-opus-4-1', 'low'),
    ], claude)
    expect(dividers).toEqual({
      s2: 'New session with model Sonnet',
      s3: 'New session with effort High',
      s4: 'New session with model default and effort Low',
      s5: 'New session with model claude-opus-4-1',
    })
  })
})
