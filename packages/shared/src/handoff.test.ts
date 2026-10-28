import { describe, expect, it } from 'vitest'
import { HANDOFF_OUTCOMES, parseHandoff, stripHandoff } from './handoff'

const block = [
  '```handoff',
  'outcome: done',
  'summary: Fixed the login redirect',
  'pull_request: https://github.com/acme/app/pull/7',
  'issues: app-1, app-2',
  'follow_ups: add tests; update docs',
  '```',
].join('\n')

describe('parseHandoff', () => {
  it('parses a well-formed block', () => {
    expect(parseHandoff(block)).toEqual({
      ok: true,
      handoff: {
        outcome: 'done',
        summary: 'Fixed the login redirect',
        pullRequest: 'https://github.com/acme/app/pull/7',
        issues: ['app-1', 'app-2'],
        followUps: ['add tests', 'update docs'],
      },
    })
  })

  it('exposes the outcome vocabulary', () => {
    expect(HANDOFF_OUTCOMES).toEqual(['done', 'partial', 'blocked'])
  })

  it('tolerates surrounding prose', () => {
    const result = parseHandoff(`All finished.\n\n${block}\n\nLet me know!`)
    expect(result.ok && result.handoff.summary).toBe('Fixed the login redirect')
  })

  it('tolerates CRLF, indentation and trailing whitespace', () => {
    const messy = '  ```handoff  \r\n  outcome: partial   \r\n\tsummary:   Half done  \r\n  ```  \r\n'
    const result = parseHandoff(messy)
    expect(result).toMatchObject({ ok: true, handoff: { outcome: 'partial', summary: 'Half done' } })
  })

  it('reports a missing block', () => {
    expect(parseHandoff('Just prose.')).toMatchObject({ ok: false, reason: 'missing' })
    expect(parseHandoff('')).toMatchObject({ ok: false, reason: 'missing' })
  })

  it('ignores fenced blocks with a different info string', () => {
    const other = '```json\n{"outcome":"done"}\n```'
    expect(parseHandoff(other)).toMatchObject({ ok: false, reason: 'missing' })
    expect(parseHandoff('```handoffs\noutcome: done\nsummary: x\n```')).toMatchObject({
      ok: false,
      reason: 'missing',
    })
  })

  it('reports an unknown outcome', () => {
    const result = parseHandoff('```handoff\noutcome: finished\nsummary: x\n```')
    expect(result).toMatchObject({ ok: false, reason: 'unknown_outcome' })
  })

  it('defaults missing optional fields to empty', () => {
    const result = parseHandoff('```handoff\noutcome: blocked\nsummary: Need creds\n```')
    expect(result).toEqual({
      ok: true,
      handoff: { outcome: 'blocked', summary: 'Need creds', pullRequest: null, issues: [], followUps: [] },
    })
  })

  it('normalises none to null and empty', () => {
    const none = '```handoff\noutcome: done\nsummary: x\npull_request: None\nissues: none\nfollow_ups: NONE\n```'
    expect(parseHandoff(none)).toMatchObject({
      ok: true,
      handoff: { pullRequest: null, issues: [], followUps: [] },
    })
  })

  it('requires outcome and summary', () => {
    expect(parseHandoff('```handoff\nsummary: x\n```')).toMatchObject({
      ok: false,
      reason: 'missing_outcome',
    })
    expect(parseHandoff('```handoff\noutcome: done\nsummary: none\n```')).toMatchObject({
      ok: false,
      reason: 'missing_summary',
    })
    expect(parseHandoff('```handoff\noutcome: done\n```')).toMatchObject({
      ok: false,
      reason: 'missing_summary',
    })
  })

  it('reports malformed blocks', () => {
    expect(parseHandoff('```handoff\noutcome done\n```')).toMatchObject({ ok: false, reason: 'malformed' })
    expect(parseHandoff('```handoff\noutcome: done\nsummary: x')).toMatchObject({
      ok: false,
      reason: 'malformed',
    })
  })

  it('accepts uppercase keys and values', () => {
    const result = parseHandoff('```handoff\nOUTCOME: Done\nSummary: x\nISSUES: a-1,a-2\n```')
    expect(result).toMatchObject({ ok: true, handoff: { outcome: 'done', issues: ['a-1', 'a-2'] } })
  })

  it('uses the last handoff block when several are present', () => {
    const first = '```handoff\noutcome: blocked\nsummary: old\n```'
    const result = parseHandoff(`${first}\n\n${block}`)
    expect(result).toMatchObject({ ok: true, handoff: { outcome: 'done' } })
  })

  it('keeps colons in values and ignores unknown keys', () => {
    const result = parseHandoff('```handoff\noutcome: done\nsummary: Note: it works\nextra: y\n```')
    expect(result).toMatchObject({ ok: true, handoff: { summary: 'Note: it works' } })
  })
})

describe('stripHandoff', () => {
  it('removes only the last handoff block and keeps the prose around it', () => {
    const message = 'Fixed it.\n\n```ts\nconst a = 1\n```\n\n```handoff\noutcome: partial\nsummary: first\n```\nBetween.\n~~~handoff\noutcome: done\nsummary: Fixed\n~~~\nThanks.'
    expect(stripHandoff(message)).toBe('Fixed it.\n\n```ts\nconst a = 1\n```\n\n```handoff\noutcome: partial\nsummary: first\n```\nBetween.\nThanks.')
  })

  it('leaves a message without a closed handoff block as it is', () => {
    expect(stripHandoff('Just text.')).toBe('Just text.')
    expect(stripHandoff('Text\n```handoff\noutcome: done')).toBe('Text\n```handoff\noutcome: done')
  })
})
