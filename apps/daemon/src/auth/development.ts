import { ADMIN_USERNAME } from '@candy-mountain/shared'
import { findActorByUsername } from './actors'
import type { AuthStrategy } from './strategy'

export function developmentStrategy(): AuthStrategy {
  return {
    name: 'development',
    resolve: c => findActorByUsername(c.var.db, ADMIN_USERNAME),
  }
}
