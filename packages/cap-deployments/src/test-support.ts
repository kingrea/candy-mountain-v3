import type { CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import type { AnyPluginType, PlatformDatabase } from '@candy-mountain/platform-daemon'
import { fixturePluginType, openTestDatabase, testKit, type TestKit, type TestKitOptions } from '@candy-mountain/platform-daemon/testing'
import { herokuDefinition } from '@candy-mountain/plugin-heroku'
import { netlifyDefinition } from '@candy-mountain/plugin-netlify'
import { deploymentsDefinition } from './definition'

/** The manifest requires a repository plugin type; tests stand one in rather than depend on the repository capability. */
export const REPOSITORY_STAND_IN: AnyPluginType = fixturePluginType('repository')

export const deploymentsConnections = (): CapabilityDefinition[] => [herokuDefinition(), netlifyDefinition()]

/** The test kit over deployments and its connections alone, unless the options name other capabilities. */
export function deploymentsKit({ capabilities = [...deploymentsConnections(), deploymentsDefinition()], pluginTypes = [REPOSITORY_STAND_IN], ...options }: TestKitOptions = {}): TestKit {
  return testKit({ capabilities, pluginTypes, ...options })
}

/** The platform's tables plus the environments table. */
export const openDeploymentsTestDatabase = (): PlatformDatabase => openTestDatabase({ definitions: [...deploymentsConnections(), deploymentsDefinition()] })
