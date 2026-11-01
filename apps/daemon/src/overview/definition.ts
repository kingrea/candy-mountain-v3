import { defineCapabilityDefinition, type CapabilityDefinition } from '../capabilities/definition'
import { overviewCapability } from './manifest'

/** The project home is views only: the web layer renders what the platform already serves, so nothing starts. */
export function overviewDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({ id: overviewCapability.id, manifest: overviewCapability })
}
