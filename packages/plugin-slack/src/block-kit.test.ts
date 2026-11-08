import { describe, expect, it } from 'vitest'
import { SLACK_RESERVED_ID_PREFIX, validateSlackBlocksPost } from './block-kit'

const TARGET = { channel: 'C01LISTED', threadTs: '1.1' }
const SECTION = { type: 'section', text: { type: 'mrkdwn', text: '*Build* passed' } }

describe('Block Kit validation', () => {
  it('accepts well-formed blocks and pins the post to the thread', () => {
    const blocks = [
      { type: 'header', text: { type: 'plain_text', text: 'Release' } },
      SECTION,
      { type: 'divider' },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'by Ana' }] },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open PR' }, url: 'https://github.com/x/y/pull/1', action_id: 'open-pr' }] },
    ]
    expect(validateSlackBlocksPost({ text: 'Release', blocks, channel: 'C01LISTED', thread_ts: '1.1' }, TARGET)).toEqual({ ok: true, post: { channel: 'C01LISTED', thread_ts: '1.1', text: 'Release', blocks } })
    expect(validateSlackBlocksPost({ text: 'x', blocks: [SECTION] }, TARGET)).toMatchObject({ ok: true, post: { channel: 'C01LISTED', thread_ts: '1.1' } })
  })

  it('refuses anything outside the thread, malformed blocks, oversize payloads and tokens', () => {
    const refused = (input: Record<string, unknown>) => {
      const result = validateSlackBlocksPost({ text: 'fallback', blocks: [SECTION], ...input }, TARGET)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      return result.ok ? '' : result.reason
    }
    expect(refused({ channel: 'C02OTHER' })).toContain('channel "C02OTHER"')
    expect(refused({ thread_ts: '9.9' })).toContain('thread "9.9"')
    expect(refused({ reply_broadcast: true })).toContain('reply_broadcast')
    expect(refused({ as_user: true, username: 'Jack' })).toContain('as_user, username')
    expect(refused({ text: '' })).toContain('text is required')
    expect(refused({ text: 'x'.repeat(3001) })).toContain('longer than')
    expect(refused({ blocks: [] })).toContain('1 to 50')
    expect(refused({ blocks: Array.from({ length: 51 }, () => SECTION) })).toContain('1 to 50')
    expect(refused({ blocks: Array.from({ length: 40 }, () => ({ type: 'markdown', text: 'y'.repeat(1000) })) })).toContain('larger than')
    expect(refused({ blocks: ['section'] })).toContain('must be an object')
    expect(refused({ blocks: [{ type: 'input', element: {} }] })).toContain('type must be one of')
    expect(refused({ blocks: [{ type: 'section' }] })).toContain('needs text or fields')
    expect(refused({ blocks: [{ type: 'header', text: { type: 'mrkdwn', text: 'x' } }] })).toContain('plain_text')
    expect(refused({ blocks: [{ type: 'image', image_url: 'https://x.test/a.png' }] })).toContain('alt_text')
    expect(refused({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'token xoxb-1234-5678-abcdef' } }] })).toContain('credential')
    expect(refused({ text: 'key xapp-1-A0-123456789' })).toContain('credential')
    expect(refused({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'ghp_' + 'a'.repeat(36) } }] })).toContain('credential')
    expect(refused({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hey <!channel>' } }] })).toContain('whole channel')
    expect(refused({ blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'broadcast', range: 'here' }] }] }] })).toContain('whole channel')
    expect(refused({ blocks: [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Allow' }, action_id: `${SLACK_RESERVED_ID_PREFIX}decision:1`, value: 'x:1' }] }] })).toContain('reserved')
  })
})
