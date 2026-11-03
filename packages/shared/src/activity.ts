export type ActivityEventType = string

export const ACTIVITY_DEFAULT_LIMIT = 50
export const ACTIVITY_MAX_LIMIT = 200

export const workspaceActivityPath = (slug: string) => `/workspaces/${slug}/activity`

export interface ActivityEvent {
  id: string
  workspaceId: string
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
export const ACTIVITY_TYPES_PATH = '/activity/types'

/** A registered event type; the web shows its own words for a type it is not told about. */
export interface ActivityEventTypeInfo {
  id: ActivityEventType
  label: string
  /** An Iconify name, or null for the web's fallback icon. */
  icon: string | null
}

/** The product's registered types, in registration order. */
export interface ActivityEventTypesResponse {
  types: ActivityEventTypeInfo[]
}

export interface CrossWorkspaceActivityEvent extends ActivityEvent {
  workspace: { slug: string, name: string, color: string }
}

export interface CrossWorkspaceActivityResponse {
  events: CrossWorkspaceActivityEvent[]
  nextCursor: string | null
}
