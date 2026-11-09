import { acpDefinition, type AcpOptions } from '@candy-mountain/cap-acp'
import { codexDefinition } from '@candy-mountain/plugin-codex'
import { claudeCodeFamilyStandInDefinition, repositoryStandInDefinition } from '@candy-mountain/testing'
import type { ModuleDefinition } from '@crab-shack/platform-sdk'
import type { CapabilityDefinition } from '@crab-shack/platform-sdk/daemon'
import { testKit, testProduct, type TestKit, type TestKitOptions } from '@crab-shack/platform-daemon/testing'
import { chatCodexDefinition } from './definition'

export const AGENT_HUB_MODULE: ModuleDefinition = {
  id: 'agent-hub',
  label: 'Agent Hub',
  description: 'Chat with coding agents.',
  icon: 'i-lucide-bot',
  capabilities: [{ capabilityId: 'chat-codex', defaultRung: 'chat' }],
}

/** The definitions codex boots on, with codex itself unless `withCodex` is false. */
export function codexTestCapabilities(acp: AcpOptions['acp'], { withCodex = true } = {}): CapabilityDefinition[] {
  return [repositoryStandInDefinition(), acpDefinition({ acp }), claudeCodeFamilyStandInDefinition(), ...(withCodex ? [codexDefinition()] : [])]
}

/** The definitions chat-codex boots on, with chat-codex itself. */
export function chatCodexTestCapabilities(acp?: AcpOptions['acp']): CapabilityDefinition[] {
  return [...codexTestCapabilities(acp), chatCodexDefinition()]
}

/** `testKit` over codex's test definitions and chat-codex in an Agent Hub module. */
export function chatCodexKit({ acp, ...options }: Omit<TestKitOptions, 'product' | 'capabilities' | 'modules'> & { acp?: AcpOptions['acp'] } = {}): TestKit {
  return testKit({ ...options, product: testProduct({ capabilities: chatCodexTestCapabilities(acp), modules: [AGENT_HUB_MODULE] }) })
}
