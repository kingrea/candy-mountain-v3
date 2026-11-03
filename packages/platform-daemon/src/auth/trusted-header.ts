import { findActorByUsername } from './actors'
import type { AuthStrategy } from './strategy'

export function trustedHeaderStrategy(header: string): AuthStrategy {
  return {
    name: 'trusted-header',
    resolve: (c) => {
      const username = c.req.header(header)?.trim()
      return username ? findActorByUsername(c.var.db, username) : null
    },
  }
}
