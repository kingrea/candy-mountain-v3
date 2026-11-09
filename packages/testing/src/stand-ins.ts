import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition } from '@crab-shack/platform-sdk/daemon'

/** acp depends on repository for checkouts; this stands it in by id and service name for tests that do not import plugin-repository. */
export function repositoryStandInDefinition(): CapabilityDefinition {
  const paths = serviceKey<{ find(workspaceId: string): string | null, get(workspaceId: string): string }>('repository.paths')
  return defineCapabilityDefinition({
    id: 'repository',
    provides: [paths],
    start: () => ({
      services: [bindService(paths, {
        find: () => null,
        get: (workspaceId: string) => {
          throw new Error(`The repository stand-in has no checkout for workspace '${workspaceId}'.`)
        },
      })],
    }),
  })
}

/** Registers the claude-code family the way the definition bringing it does, without plugin-claude-code. */
export function claudeCodeFamilyStandInDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({ id: 'claude-code', dependsOn: ['acp'], sessionFamilies: [{ id: 'claude-code', name: 'Claude Code' }] })
}
