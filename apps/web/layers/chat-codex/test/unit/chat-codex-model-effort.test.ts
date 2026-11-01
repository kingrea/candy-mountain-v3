import type { ChatAgentOptions, ChatThreadSession } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { CHAT_CODEX_OPTION_DEFAULT, chatCodexHasOptions, chatCodexOptionChoice, chatCodexOptionItems, chatCodexOptionValue, chatCodexSessionDividers } from '../../app/utils/chat-codex-model-effort'

const agent: ChatAgentOptions = {
  agentId: 'codex',
  family: 'codex',
  models: [{ value: 'fast', label: 'Fast' }, { value: 'smart', label: 'Smart' }],
  efforts: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }],
}

const session = (sessionId: string, model: string | null, effort: string | null): ChatThreadSession => ({ sessionId, model, effort, createdAt: '2026-10-28T10:00:00.000Z' })

describe('model and effort options', () => {
  it('leads the items with the agent default and round-trips it as null', () => {
    expect(chatCodexOptionItems(agent.models, 'Default model')).toEqual([
      { label: 'Default model', value: CHAT_CODEX_OPTION_DEFAULT },
      { label: 'Fast', value: 'fast' },
      { label: 'Smart', value: 'smart' },
    ])
    expect(chatCodexOptionValue(null)).toBe(CHAT_CODEX_OPTION_DEFAULT)
    expect(chatCodexOptionChoice(CHAT_CODEX_OPTION_DEFAULT)).toBeNull()
    expect(chatCodexOptionChoice('fast')).toBe('fast')
  })

  it('reports no options for an agent with empty lists', () => {
    expect(chatCodexHasOptions(agent)).toBe(true)
    expect(chatCodexHasOptions({ agentId: 'bot', family: 'codex', models: [], efforts: [] })).toBe(false)
    expect(chatCodexHasOptions(null)).toBe(false)
  })

  it('words a divider for every session that replaced another', () => {
    const dividers = chatCodexSessionDividers([
      session('s1', null, null),
      session('s2', 'smart', null),
      session('s3', 'smart', 'high'),
      session('s4', null, 'low'),
      session('s5', 'unlisted-model', 'low'),
    ], agent)
    expect(dividers).toEqual({
      s2: 'New session with model Smart',
      s3: 'New session with effort High',
      s4: 'New session with model default and effort Low',
      s5: 'New session with model unlisted-model',
    })
  })
})
