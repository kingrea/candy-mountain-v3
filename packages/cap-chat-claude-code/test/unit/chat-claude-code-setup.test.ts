import { describe, expect, it } from 'vitest'
import { chatClaudeCodeExecutableSummary, chatClaudeCodePathToSave, chatClaudeCodeSetupReady } from '../../app/utils/chat-claude-code-setup'

describe('claude code setup helpers', () => {
  it('stores no path for a claude on PATH, the found path otherwise, and nothing until checked', () => {
    expect(chatClaudeCodePathToSave(null)).toBeNull()
    expect(chatClaudeCodePathToSave({ status: 'checking' })).toBeNull()
    expect(chatClaudeCodePathToSave({ status: 'checked', custom: false, result: { found: false, reason: 'no', searched: [] } })).toBeNull()
    expect(chatClaudeCodePathToSave({ status: 'checked', custom: false, result: { found: true, path: '/usr/local/bin/claude', onPath: true } })).toBe('')
    expect(chatClaudeCodePathToSave({ status: 'checked', custom: false, result: { found: true, path: '/Users/me/.local/bin/claude', onPath: false } })).toBe('/Users/me/.local/bin/claude')
    expect(chatClaudeCodePathToSave({ status: 'checked', custom: true, result: { found: true, path: '/opt/claude', onPath: false, version: '2.0.0' } })).toBe('/opt/claude')
  })

  it('summarises a probe for the admin', () => {
    expect(chatClaudeCodeExecutableSummary({ found: true, path: '/opt/claude', onPath: false, version: '2.1.3' })).toEqual({ title: 'Found claude 2.1.3', detail: '/opt/claude' })
    expect(chatClaudeCodeExecutableSummary({ found: true, path: '/opt/claude', onPath: true })).toEqual({ title: 'Found claude', detail: '/opt/claude' })
    expect(chatClaudeCodeExecutableSummary({ found: false, reason: 'Nope.', searched: ['/bin'] })).toEqual({ title: 'The claude executable could not be found', detail: 'Nope.' })
  })

  it('needs a token only in token mode and only when none is stored', () => {
    expect(chatClaudeCodeSetupReady('login', '', false)).toBe(true)
    expect(chatClaudeCodeSetupReady('token', '', false)).toBe(false)
    expect(chatClaudeCodeSetupReady('token', ' tok ', false)).toBe(true)
    expect(chatClaudeCodeSetupReady('token', '', true)).toBe(true)
  })
})
