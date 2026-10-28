export const AUTH_PATH = '/auth'
export const ME_PATH = '/auth/me'
export const AUTH_STRATEGY_PATH = '/auth/strategy'
export const LOGIN_PATH = '/auth/login'
export const LOGOUT_PATH = '/auth/logout'

export const AUTH_STRATEGY_NAMES = ['development', 'password', 'trusted-header'] as const
export type AuthStrategyName = (typeof AUTH_STRATEGY_NAMES)[number]

export const ADMIN_ROLE = 'admin'
export const ADMIN_USERNAME = 'admin'

export const UNAUTHENTICATED_ERROR_CODE = 'unauthenticated'
export const INVALID_CREDENTIALS_ERROR_CODE = 'invalid_credentials'
export const FORBIDDEN_ERROR_CODE = 'forbidden'
export const RATE_LIMITED_ERROR_CODE = 'rate_limited'

export const SESSION_COOKIE_NAME = 'cm_session'

export interface Actor {
  id: string
  username: string
  displayName: string
  roles: string[]
}

export interface MeResponse {
  actor: Actor
}

export interface AuthStrategyResponse {
  strategy: AuthStrategyName
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  actor: Actor
}

export function isAuthStrategyName(value: unknown): value is AuthStrategyName {
  return AUTH_STRATEGY_NAMES.includes(value as AuthStrategyName)
}

export function isAdmin(actor: Pick<Actor, 'roles'>): boolean {
  return actor.roles.includes(ADMIN_ROLE)
}
