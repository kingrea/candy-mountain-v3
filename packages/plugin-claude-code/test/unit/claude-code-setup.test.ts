import { describe, expect, it } from 'vitest'
import { claudeCodeExecutableSummary, claudeCodePathToSave, claudeCodeSetupReady } from '../../app/utils/claude-code-setup'

describe('claude code setup helpers', () => {
  it('stores no path for a claude on PATH, the found path otherwise, and nothing until checked', () => {
    expect(claudeCodePathToSave(null)).toBeNull()
    expect(claudeCodePathToSave({ status: 'checking' })).toBeNull()
    expect(claudeCodePathToSave({ status: 'checked', custom: false, result: { found: false, reason: 'no', searched: [] } })).toBeNull()
    expect(claudeCodePathToSave({ status: 'checked', custom: false, result: { found: true, path: '/usr/local/bin/claude', onPath: true } })).toBe('')
    expect(claudeCodePathToSave({ status: 'checked', custom: false, result: { found: true, path: '/Users/me/.local/bin/claude', onPath: false } })).toBe('/Users/me/.local/bin/claude')
    expect(claudeCodePathToSave({ status: 'checked', custom: true, result: { found: true, path: '/opt/claude', onPath: false, version: '2.0.0' } })).toBe('/opt/claude')
  })

  it('summarises a probe for the admin', () => {
    expect(claudeCodeExecutableSummary({ found: true, path: '/opt/claude', onPath: false, version: '2.1.3' })).toEqual({ title: 'Found claude 2.1.3', detail: '/opt/claude' })
    expect(claudeCodeExecutableSummary({ found: true, path: '/opt/claude', onPath: true })).toEqual({ title: 'Found claude', detail: '/opt/claude' })
    expect(claudeCodeExecutableSummary({ found: false, reason: 'Nope.', searched: ['/bin'] })).toEqual({ title: 'The claude executable could not be found', detail: 'Nope.' })
  })

  it('needs a token only in token mode and only when none is stored', () => {
    expect(claudeCodeSetupReady('login', '', false)).toBe(true)
    expect(claudeCodeSetupReady('token', '', false)).toBe(false)
    expect(claudeCodeSetupReady('token', ' tok ', false)).toBe(true)
    expect(claudeCodeSetupReady('token', '', true)).toBe(true)
  })
})
