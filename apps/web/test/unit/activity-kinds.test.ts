import { describe, expect, it } from 'vitest'
import { ACTIVITY_FALLBACK_ICON, ACTIVITY_TYPE_ITEMS, activityEventKind } from '../../app/utils/activity'

describe('activityEventKind', () => {
  it('names the types the daemon emits today', () => {
    expect(activityEventKind('incident.opened')).toEqual({ label: 'Incident opened', icon: 'i-lucide-triangle-alert' })
    expect(ACTIVITY_TYPE_ITEMS.map(item => item.value)).toContain('deploy.attempted')
  })

  it('gives an unknown type its id in words and a fallback icon', () => {
    expect(activityEventKind('widget.built')).toEqual({ label: 'Widget built', icon: ACTIVITY_FALLBACK_ICON })
    expect(activityEventKind('crm_lead-won')).toEqual({ label: 'Crm lead won', icon: ACTIVITY_FALLBACK_ICON })
  })
})
