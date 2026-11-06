import { fixturePluginType, openTestDatabase, startTestPlatform, type AnyPluginType, type Platform, type PlatformDatabase, type TestPlatformOptions } from '@candy-mountain/platform-daemon'
import { deploymentsDefinition } from './definition'

/** The manifest requires a repository plugin type; tests stand one in rather than depend on the repository capability. */
export const REPOSITORY_STAND_IN: AnyPluginType = fixturePluginType('repository')

/** A platform booting deployments alone, unless the options name other capabilities. */
export function startDeploymentsPlatform(dataDir: string, { capabilities = [deploymentsDefinition()], pluginTypes = [REPOSITORY_STAND_IN], ...options }: TestPlatformOptions = {}): Platform {
  return startTestPlatform(dataDir, { capabilities, pluginTypes, ...options })
}

/** The platform's tables plus the environments table. */
export const openDeploymentsTestDatabase = (): PlatformDatabase => openTestDatabase({ definitions: [deploymentsDefinition()] })
