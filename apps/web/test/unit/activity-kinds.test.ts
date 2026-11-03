import type { ActivityEventTypeInfo } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_FALLBACK_ICON, activityEventKind, activityTypeItems } from '../../app/utils/activity'

const registered: ActivityEventTypeInfo[] = [
  { id: 'incident.opened', label: 'Incident opened', icon: 'i-lucide-triangle-alert' },
  { id: 'deploy.attempted', label: 'Deploy', icon: null },
]

describe('activityEventKind', () => {
  it('names a registered type as the daemon labels it', () => {
    expect(activityEventKind('incident.opened', registered)).toEqual({ label: 'Incident opened', icon: 'i-lucide-triangle-alert' })
    expect(activityEventKind('deploy.attempted', registered)).toEqual({ label: 'Deploy', icon: ACTIVITY_FALLBACK_ICON })
    expect(activityTypeItems(registered).map(item => item.value)).toEqual(['incident.opened', 'deploy.attempted'])
  })

  it('gives an unknown type its id in words and a fallback icon', () => {
    expect(activityEventKind('widget.built', registered)).toEqual({ label: 'Widget built', icon: ACTIVITY_FALLBACK_ICON })
    expect(activityEventKind('crm_lead-won')).toEqual({ label: 'Crm lead won', icon: ACTIVITY_FALLBACK_ICON })
  })

  it('offers no filter for a type the product does not register', () => {
    expect(activityTypeItems(registered.filter(t => !t.id.startsWith('incident.'))).map(item => item.value)).toEqual(['deploy.attempted'])
  })
})
