export const ACTIVITY_EVENT_TYPES = [
  'session.started',
  'run.started',
  'bot.handoff',
  'incident.opened',
  'incident.closed',
  'deploy.attempted',
] as const
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number]

export const ACTIVITY_DEFAULT_LIMIT = 50
export const ACTIVITY_MAX_LIMIT = 200

export const projectActivityPath = (slug: string) => `/projects/${slug}/activity`

export interface ActivityEvent {
  id: string
  projectId: string
  type: ActivityEventType
  title: string
  /** ISO timestamp. */
  occurredAt: string
  /** In-app path such as `/p/acme/agents`, never an absolute URL. */
  link: string | null
  payload: Record<string, unknown> | null
}

export interface ActivityListResponse {
  events: ActivityEvent[]
  /** Pass as `before` to get the next older page; null when there are no more. */
  nextCursor: string | null
}

export const ACTIVITY_ERROR_CODES = ['invalid_request', 'payload_too_large'] as const
export type ActivityErrorCode = (typeof ACTIVITY_ERROR_CODES)[number]

export const ACTIVITY_PATH = '/activity'

export interface CrossProjectActivityEvent extends ActivityEvent {
  project: { slug: string, name: string, color: string }
}

export interface CrossProjectActivityResponse {
  events: CrossProjectActivityEvent[]
  nextCursor: string | null
}
