import { acpDefinition, type AcpOptions } from '@candy-mountain/cap-acp'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { claudeCodeDefinition } from './definition'

/** acp depends on repository for checkouts; claude-code does not, so the tests stand it in by id and service name instead of importing plugin-repository. */
function repositoryStandInDefinition(): CapabilityDefinition {
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

/** The definitions claude-code boots on, with claude-code itself unless `withClaudeCode` is false. */
export function claudeCodeTestCapabilities(acp: AcpOptions['acp'], { withClaudeCode = true } = {}): CapabilityDefinition[] {
  return [repositoryStandInDefinition(), acpDefinition({ acp }), ...(withClaudeCode ? [claudeCodeDefinition()] : [])]
}
