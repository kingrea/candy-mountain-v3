export const HEALTH_PATH = '/health'

export const HEALTH_STATUSES = ['ok'] as const
export type HealthStatus = (typeof HEALTH_STATUSES)[number]

export interface HealthResponse {
  status: HealthStatus
}

export function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === 'object'
    && value !== null
    && HEALTH_STATUSES.includes((value as { status?: unknown }).status as HealthStatus)
  )
}
