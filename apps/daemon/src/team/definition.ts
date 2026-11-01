import { defineCapabilityDefinition, type CapabilityDefinition, type CapabilityRuntime } from '../capabilities/definition'
import { teamCapability } from './manifest'
import { teamMemberRoutes } from './routes'

/** The routes alone, for tests that need no platform. */
export function teamRoutes(): Pick<CapabilityRuntime, 'workspaceRoutes'> {
  return { workspaceRoutes: [teamMemberRoutes()] }
}

export function teamDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: teamCapability.id,
    manifest: teamCapability,
    start: () => teamRoutes(),
  })
}
