import type { ActivityEventType } from '@candy-mountain/shared'

export interface ActivityEventKind {
  label: string
  icon: string
}

// Event types are open strings, so this names the ones the daemon emits today and activityEventKind covers the rest.
export const ACTIVITY_EVENT_KINDS: Readonly<Record<ActivityEventType, ActivityEventKind>> = {
  'session.started': { label: 'Session started', icon: 'i-lucide-message-square' },
  'run.started': { label: 'Run started', icon: 'i-lucide-play' },
  'bot.handoff': { label: 'Bot handoff', icon: 'i-lucide-bot' },
  'incident.opened': { label: 'Incident opened', icon: 'i-lucide-triangle-alert' },
  'incident.closed': { label: 'Incident closed', icon: 'i-lucide-circle-check' },
  'deploy.attempted': { label: 'Deploy', icon: 'i-lucide-rocket' },
}

export const ACTIVITY_FALLBACK_ICON = 'i-lucide-circle-dot'

/** An unlisted type reads as its id in words, so 'widget.built' shows as 'Widget built'. */
export function activityEventKind(type: ActivityEventType): ActivityEventKind {
  const known = ACTIVITY_EVENT_KINDS[type]
  if (known) return known
  const words = type.split(/[-_.]+/).filter(Boolean).join(' ')
  return { label: words.charAt(0).toUpperCase() + words.slice(1) || type, icon: ACTIVITY_FALLBACK_ICON }
}

export const ACTIVITY_TYPE_ITEMS = Object.entries(ACTIVITY_EVENT_KINDS).map(([value, { label }]) => ({ label, value }))

export const ACTIVITY_SINCE_OPTIONS = [
  { label: 'Any time', value: 'all', hours: null },
  { label: 'Last 24 hours', value: '24h', hours: 24 },
  { label: 'Last 7 days', value: '7d', hours: 24 * 7 },
  { label: 'Last 30 days', value: '30d', hours: 24 * 30 },
] as const
