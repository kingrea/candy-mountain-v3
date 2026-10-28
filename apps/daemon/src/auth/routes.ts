import type { AuthStrategyResponse, MeResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import type { AuthStrategy } from './strategy'

export function authRoutes(strategy: AuthStrategy) {
  const routes = new Hono<AppEnv>()
  routes.get('/me', c => c.json<MeResponse>({ actor: c.var.actor }))
  routes.get('/strategy', c => c.json<AuthStrategyResponse>({ strategy: c.var.authStrategy }))
  if (strategy.routes) routes.route('/', strategy.routes())
  return routes
}
