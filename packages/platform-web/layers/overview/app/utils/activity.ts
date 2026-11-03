export const OVERVIEW_RANGES = [
  { value: 'all', label: 'All time', ms: null },
  { value: '1h', label: 'Last hour', ms: 3_600_000 },
  { value: '24h', label: 'Last 24 hours', ms: 86_400_000 },
  { value: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { value: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
] as const

export type OverviewRange = (typeof OVERVIEW_RANGES)[number]['value']
