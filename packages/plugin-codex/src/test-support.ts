import { acpDefinition, type AcpOptions } from '@candy-mountain/cap-acp'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { startTestPlatform, testProduct, type Platform, type TestPlatformOptions } from '@candy-mountain/platform-daemon'
import { codexDefinition } from './definition'

/** acp depends on repository for checkouts; codex does not, so the tests stand it in by id and service name instead of importing plugin-repository. */
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

/** Registers the claude-code family the way the definition bringing it does, so the tests can check codex registers after it. */
function claudeCodeFamilyStandInDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({ id: 'claude-code', dependsOn: ['acp'], sessionFamilies: [{ id: 'claude-code', name: 'Claude Code' }] })
}

/** The definitions codex boots on, with codex itself unless `withCodex` is false. */
export function codexTestCapabilities(acp: AcpOptions['acp'], { withCodex = true } = {}): CapabilityDefinition[] {
  return [repositoryStandInDefinition(), acpDefinition({ acp }), claudeCodeFamilyStandInDefinition(), ...(withCodex ? [codexDefinition()] : [])]
}

/** `startTestPlatform` over the repository stand-in, acp, the claude-code family stand-in and codex. */
export function startCodexPlatform(dataDir: string, { acp, withCodex = true, ...options }: Omit<TestPlatformOptions, 'product' | 'capabilities' | 'modules'> & { acp?: AcpOptions['acp'], withCodex?: boolean } = {}): Platform {
  return startTestPlatform(dataDir, {
    product: testProduct({ capabilities: codexTestCapabilities(acp, { withCodex }) }),
    ...options,
  })
}
