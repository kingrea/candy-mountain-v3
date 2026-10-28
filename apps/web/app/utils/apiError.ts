import { isApiErrorBody } from '@candy-mountain/shared'

export interface ApiErrorInfo {
  code: string
  message: string
}

export function toApiError(error: unknown): ApiErrorInfo {
  const data = (error as { data?: unknown } | null)?.data
  if (isApiErrorBody(data)) return data.error
  return { code: 'unknown', message: error instanceof Error ? error.message : 'Request failed' }
}
