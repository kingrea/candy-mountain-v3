export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const error = (value as { error?: unknown }).error
  return (
    typeof error === 'object'
    && error !== null
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { message?: unknown }).message === 'string'
  )
}
