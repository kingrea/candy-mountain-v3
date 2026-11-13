import { defineCapabilityDefinition, type CapabilityDefinition, type CapabilityRuntime } from '@crab-shack/platform-sdk/daemon'
import { teamCapability } from './manifest'
import { teamMemberRoutes } from './routes'
import { srcPath } from './package-root'
import * as teamSchema from './schema'

/** The routes alone, for tests that need no platform. */
export function teamRoutes(): Pick<CapabilityRuntime, 'workspaceRoutes'> {
  return { workspaceRoutes: [teamMemberRoutes()] }
}

export function teamDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: teamCapability.id,
    package: '@candy-mountain/cap-team',
    sdkMajor: 0,
    manifest: teamCapability,
    schema: { schema: teamSchema, migrationsFolder: srcPath('migrations') },
    start: () => teamRoutes(),
  })
}
