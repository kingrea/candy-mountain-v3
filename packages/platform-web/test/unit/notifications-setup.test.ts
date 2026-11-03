import type { NotificationChannelInfo, NotificationRule } from '@candy-mountain/platform-sdk'
import { describe, expect, it } from 'vitest'
import { deliveryState, draftChanged, draftDestination, draftError, PLAIN_DESTINATION_HINTS, ruleToDraft, type DestinationHints } from '../../app/utils/notifications-setup'

const rule = (overrides: Partial<NotificationRule> = {}): NotificationRule =>
  ({ enabled: false, destination: null, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null, ...overrides })

const hints: DestinationHints = {
  channel: { label: 'Channel', placeholder: 'C1', help: '', pattern: '^C', mismatch: 'Not a channel ID.' },
  member: { label: 'Direct message', placeholder: 'U1', help: '', pattern: '^U', mismatch: 'Not a member ID.' },
}

const channel = (id: string, sender: string | null): NotificationChannelInfo =>
  ({ id, label: id, sender, setupHelp: `Set up ${id}.`, setup: { label: id, link: `/${id}` }, destinations: hints })

describe('drafts', () => {
  it('round-trips a destination', () => {
    expect(ruleToDraft(rule({ enabled: true, destination: { memberId: 'U123' } }))).toEqual({ enabled: true, type: 'member', id: 'U123' })
    expect(draftDestination({ enabled: true, type: 'channel', id: ' C123 ' })).toEqual({ channelId: 'C123' })
    expect(draftDestination({ enabled: false, type: 'channel', id: '' })).toBeNull()
  })

  it('validates ids against the channel\'s hints', () => {
    expect(draftError({ enabled: true, type: 'channel', id: '' }, hints)).toMatch(/destination/)
    expect(draftError({ enabled: false, type: 'channel', id: '' }, hints)).toBeNull()
    expect(draftError({ enabled: true, type: 'channel', id: 'U123' }, hints)).toBe('Not a channel ID.')
    expect(draftError({ enabled: true, type: 'member', id: 'U123' }, hints)).toBeNull()
    expect(draftError({ enabled: true, type: 'channel', id: 'anything' }, PLAIN_DESTINATION_HINTS)).toBeNull()
  })

  it('detects changes', () => {
    const saved = rule({ enabled: true, destination: { channelId: 'C123' } })
    expect(draftChanged(ruleToDraft(saved), saved)).toBe(false)
    expect(draftChanged({ ...ruleToDraft(saved), id: 'C999' }, saved)).toBe(true)
  })
})

describe('deliveryState', () => {
  it('follows the daemon\'s active channel and falls back to plain hints without channels', () => {
    const answer = { channels: [channel('pager', null), channel('mail', 'Project bot amy')], activeChannelId: 'mail' }
    expect(deliveryState(answer)).toMatchObject({ active: { id: 'mail', sender: 'Project bot amy' }, hints })
    expect(deliveryState({ channels: [channel('mail', null)], activeChannelId: null })).toMatchObject({ active: null, hints })
    expect(deliveryState(null)).toEqual({ active: null, channels: [], hints: PLAIN_DESTINATION_HINTS })
  })
})
