import { acpDefinition, type AcpOptions } from '@candy-mountain/cap-acp'
import { claudeCodeFamilyStandInDefinition, repositoryStandInDefinition } from '@candy-mountain/testing'
import type { CapabilityDefinition } from '@crab-shack/platform-sdk/daemon'
import { codexDefinition } from './definition'

/** The definitions codex boots on, with codex itself unless `withCodex` is false; the claude-code family lets tests check codex registers after it. */
export function codexTestCapabilities(acp: AcpOptions['acp'], { withCodex = true } = {}): CapabilityDefinition[] {
  return [repositoryStandInDefinition(), acpDefinition({ acp }), claudeCodeFamilyStandInDefinition(), ...(withCodex ? [codexDefinition()] : [])]
}
