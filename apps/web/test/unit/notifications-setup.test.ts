import type { Bot, NotificationRule, PluginInstance } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { draftChanged, draftDestination, draftError, ruleToDraft, slackIdentity } from '../../app/utils/notifications-setup'

const rule = (overrides: Partial<NotificationRule> = {}): NotificationRule =>
  ({ enabled: false, destination: null, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null, ...overrides })

const bot = (name: string, token: 'set' | 'unset') =>
  ({ name, createdAt: '2026-01-01', secrets: { slackBotToken: token, slackAppToken: 'unset' } }) as unknown as Bot

describe('drafts', () => {
  it('round-trips a destination', () => {
    expect(ruleToDraft(rule({ enabled: true, destination: { memberId: 'U123' } }))).toEqual({ enabled: true, type: 'member', id: 'U123' })
    expect(draftDestination({ enabled: true, type: 'channel', id: ' C123 ' })).toEqual({ channelId: 'C123' })
    expect(draftDestination({ enabled: false, type: 'channel', id: '' })).toBeNull()
  })

  it('validates ids per destination type', () => {
    expect(draftError({ enabled: true, type: 'channel', id: '' })).toMatch(/destination/)
    expect(draftError({ enabled: false, type: 'channel', id: '' })).toBeNull()
    expect(draftError({ enabled: true, type: 'channel', id: 'U123' })).toMatch(/channel ID/)
    expect(draftError({ enabled: true, type: 'member', id: 'U123' })).toBeNull()
  })

  it('detects changes', () => {
    const saved = rule({ enabled: true, destination: { channelId: 'C123' } })
    expect(draftChanged(ruleToDraft(saved), saved)).toBe(false)
    expect(draftChanged({ ...ruleToDraft(saved), id: 'C999' }, saved)).toBe(true)
  })
})

describe('slackIdentity', () => {
  const plugin = { type: 'slack', secrets: { botToken: 'set' } } as unknown as PluginInstance
  it('prefers the first bot with a token, then the plugin, else none', () => {
    expect(slackIdentity([bot('zed', 'set'), bot('amy', 'set'), bot('ann', 'unset')], [plugin])).toEqual({ source: 'bot', label: 'Project bot amy' })
    expect(slackIdentity([bot('amy', 'unset')], [plugin]).source).toBe('plugin')
    expect(slackIdentity(null, []).source).toBe('none')
  })
})
