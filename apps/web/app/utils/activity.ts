import type { ActivityEventType, ActivityEventTypeInfo } from '@candy-mountain/shared'

export interface ActivityEventKind {
  label: string
  icon: string
}

export const ACTIVITY_FALLBACK_ICON = 'i-lucide-circle-dot'

/** A registered type reads as the daemon labels it; any other as its id in words, so 'widget.built' shows as 'Widget built'. */
export function activityEventKind(type: ActivityEventType, registered: readonly ActivityEventTypeInfo[] = []): ActivityEventKind {
  const known = registered.find(info => info.id === type)
  if (known) return { label: known.label, icon: known.icon ?? ACTIVITY_FALLBACK_ICON }
  const words = type.split(/[-_.]+/).filter(Boolean).join(' ')
  return { label: words.charAt(0).toUpperCase() + words.slice(1) || type, icon: ACTIVITY_FALLBACK_ICON }
}

export const activityTypeItems = (registered: readonly ActivityEventTypeInfo[]) =>
  registered.map(info => ({ value: info.id, ...activityEventKind(info.id, registered) }))

export const ACTIVITY_SINCE_OPTIONS = [
  { label: 'Any time', value: 'all', hours: null },
  { label: 'Last 24 hours', value: '24h', hours: 24 },
  { label: 'Last 7 days', value: '7d', hours: 24 * 7 },
  { label: 'Last 30 days', value: '30d', hours: 24 * 30 },
] as const
