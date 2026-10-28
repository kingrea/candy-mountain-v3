import type { ActivityEventType } from '@candy-mountain/shared'

export const ACTIVITY_EVENT_KINDS: Record<ActivityEventType, { label: string, icon: string }> = {
  'session.started': { label: 'Session started', icon: 'i-lucide-message-square' },
  'run.started': { label: 'Run started', icon: 'i-lucide-play' },
  'bot.handoff': { label: 'Bot handoff', icon: 'i-lucide-bot' },
  'incident.opened': { label: 'Incident opened', icon: 'i-lucide-triangle-alert' },
  'incident.closed': { label: 'Incident closed', icon: 'i-lucide-circle-check' },
  'deploy.attempted': { label: 'Deploy', icon: 'i-lucide-rocket' },
}

export const ACTIVITY_SINCE_OPTIONS = [
  { label: 'Any time', value: 'all', hours: null },
  { label: 'Last 24 hours', value: '24h', hours: 24 },
  { label: 'Last 7 days', value: '7d', hours: 24 * 7 },
  { label: 'Last 30 days', value: '30d', hours: 24 * 30 },
] as const
