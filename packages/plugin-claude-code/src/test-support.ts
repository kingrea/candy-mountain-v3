import { acpDefinition, type AcpOptions } from '@candy-mountain/cap-acp'
import { repositoryStandInDefinition } from '@candy-mountain/testing'
import type { CapabilityDefinition } from '@crab-shack/platform-sdk/daemon'
import { claudeCodeDefinition } from './definition'

/** The definitions claude-code boots on, with claude-code itself unless `withClaudeCode` is false. */
export function claudeCodeTestCapabilities(acp: AcpOptions['acp'], { withClaudeCode = true } = {}): CapabilityDefinition[] {
  return [repositoryStandInDefinition(), acpDefinition({ acp }), ...(withClaudeCode ? [claudeCodeDefinition()] : [])]
}
