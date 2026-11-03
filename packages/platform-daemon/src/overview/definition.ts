import { defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { overviewCapability } from './manifest'

/** The workspace home is views only: the web layer renders what the platform already serves, so nothing starts. */
export function overviewDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({ id: overviewCapability.id, manifest: overviewCapability })
}
