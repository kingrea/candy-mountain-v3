import { defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { netlifyPluginType } from './plugin-type'

export const NETLIFY_CAPABILITY_ID = 'netlify'

/** Service-only: brings the netlify plugin type; dependents import its operations from this package's root entry. */
export function netlifyDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: NETLIFY_CAPABILITY_ID,
    pluginTypes: [netlifyPluginType],
  })
}
