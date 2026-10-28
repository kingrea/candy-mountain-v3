import { ACTIVITY_EVENT_TYPES, type ActivityEventType } from '@candy-mountain/shared'

export const OVERVIEW_EVENT_KINDS: Record<ActivityEventType, { label: string, icon: string }> = {
  'session.started': { label: 'Session started', icon: 'i-lucide-message-square' },
  'run.started': { label: 'Run started', icon: 'i-lucide-play' },
  'bot.handoff': { label: 'Bot handoff', icon: 'i-lucide-bot' },
  'incident.opened': { label: 'Incident opened', icon: 'i-lucide-triangle-alert' },
  'incident.closed': { label: 'Incident closed', icon: 'i-lucide-circle-check' },
  'deploy.attempted': { label: 'Deploy', icon: 'i-lucide-rocket' },
}

export const OVERVIEW_TYPE_ITEMS = ACTIVITY_EVENT_TYPES.map(type => ({ value: type, label: OVERVIEW_EVENT_KINDS[type].label, icon: OVERVIEW_EVENT_KINDS[type].icon }))

export const OVERVIEW_RANGES = [
  { value: 'all', label: 'All time', ms: null },
  { value: '1h', label: 'Last hour', ms: 3_600_000 },
  { value: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
] as const

export type OverviewRange = (typeof OVERVIEW_RANGES)[number]['value']
