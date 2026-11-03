import type { CapabilityRegistry } from '../capabilities'
import type { Db } from '../db'
import type { ModuleRegistry } from '../modules'

/** What grant storage and rung resolution need; route handlers can pass `c.var`. */
export interface AccessDeps {
  db: Db
  capabilities: CapabilityRegistry
  modules: ModuleRegistry
}
