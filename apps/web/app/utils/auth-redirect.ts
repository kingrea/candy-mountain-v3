import type { AuthStrategyName } from '@candy-mountain/shared'

export const LOGIN_PAGE_PATH = '/login'
export const LOGIN_REDIRECT_QUERY = 'redirect'

export interface AuthRouteInput {
  path: string
  fullPath: string
  signedIn: boolean
  strategy: AuthStrategyName | null
  redirectQuery?: unknown
}

// Rejects anything that could leave the origin or loop back into login.
export function safeRedirectTarget(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/'
  const path = value.split(/[?#]/)[0]
  return path === LOGIN_PAGE_PATH ? '/' : value
}

export function loginPathFor(fullPath: string): string {
  return `${LOGIN_PAGE_PATH}?${LOGIN_REDIRECT_QUERY}=${encodeURIComponent(fullPath)}`
}

// Returns the path to redirect to, or null to let the navigation proceed.
export function decideAuthRedirect(input: AuthRouteInput): string | null {
  const { path, fullPath, signedIn, strategy, redirectQuery } = input
  if (path === LOGIN_PAGE_PATH) {
    if (signedIn) return safeRedirectTarget(redirectQuery)
    return strategy === 'password' ? null : '/'
  }
  if (signedIn) return null
  return strategy === 'password' ? loginPathFor(fullPath) : null
}
