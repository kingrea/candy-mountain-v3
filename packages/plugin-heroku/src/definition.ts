import { defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { herokuPluginType } from './plugin-type'

export const HEROKU_CAPABILITY_ID = 'heroku'

/** Service-only: brings the heroku plugin type; dependents import its operations from this package's root entry. */
export function herokuDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: HEROKU_CAPABILITY_ID,
    pluginTypes: [herokuPluginType],
  })
}
