import { describe, expect, it } from 'vitest'
import { resolveUptimeSettings } from './config'

describe('resolveUptimeSettings', () => {
  it('defaults to 500 checks kept for 30 days', () => {
    expect(resolveUptimeSettings({})).toEqual({ historyMax: 500, historyMaxAgeMs: 30 * 86_400_000 })
  })

  it('reads the uptime history bounds', () => {
    expect(resolveUptimeSettings({ CM_UPTIME_HISTORY_MAX: '20', CM_UPTIME_HISTORY_MAX_AGE: '12h' })).toEqual({ historyMax: 20, historyMaxAgeMs: 43_200_000 })
    expect(() => resolveUptimeSettings({ CM_UPTIME_HISTORY_MAX: '0' })).toThrow(/CM_UPTIME_HISTORY_MAX/)
    expect(() => resolveUptimeSettings({ CM_UPTIME_HISTORY_MAX_AGE: '30' })).toThrow(/CM_UPTIME_HISTORY_MAX_AGE/)
  })
})
