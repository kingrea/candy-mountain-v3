import type { CapabilityDefinition } from './capabilities/definition'
import { threadsDefinition } from './threads/definition'

/** Started for every product ahead of its own definitions, so a product definition may name them in `dependsOn`. */
export function platformDefinitions(): readonly CapabilityDefinition[] {
  return [threadsDefinition()]
}
