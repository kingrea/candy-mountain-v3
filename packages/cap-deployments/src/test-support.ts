import type { CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { fixturePluginType, openTestDatabase, startTestPlatform, type AnyPluginType, type Platform, type PlatformDatabase, type TestPlatformOptions } from '@candy-mountain/platform-daemon'
import { herokuDefinition } from '@candy-mountain/plugin-heroku'
import { netlifyDefinition } from '@candy-mountain/plugin-netlify'
import { deploymentsDefinition } from './definition'

/** The manifest requires a repository plugin type; tests stand one in rather than depend on the repository capability. */
export const REPOSITORY_STAND_IN: AnyPluginType = fixturePluginType('repository')

export const deploymentsConnections = (): CapabilityDefinition[] => [herokuDefinition(), netlifyDefinition()]

/** A platform booting deployments and its connections alone, unless the options name other capabilities. */
export function startDeploymentsPlatform(dataDir: string, { capabilities = [...deploymentsConnections(), deploymentsDefinition()], pluginTypes = [REPOSITORY_STAND_IN], ...options }: TestPlatformOptions = {}): Platform {
  return startTestPlatform(dataDir, { capabilities, pluginTypes, ...options })
}

/** The platform's tables plus the environments table. */
export const openDeploymentsTestDatabase = (): PlatformDatabase => openTestDatabase({ definitions: [...deploymentsConnections(), deploymentsDefinition()] })
