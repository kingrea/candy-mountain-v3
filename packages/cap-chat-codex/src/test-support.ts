import type { AcpOptions } from '@candy-mountain/cap-acp'
import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import type { CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { testKit, testProduct, type TestKit, type TestKitOptions } from '@candy-mountain/platform-daemon/testing'
import { codexTestCapabilities } from '@candy-mountain/plugin-codex'
import { chatCodexDefinition } from './definition'

export const AGENT_HUB_MODULE: ModuleDefinition = {
  id: 'agent-hub',
  label: 'Agent Hub',
  description: 'Chat with coding agents.',
  icon: 'i-lucide-bot',
  capabilities: [{ capabilityId: 'chat-codex', defaultRung: 'chat' }],
}

/** The definitions chat-codex boots on, with chat-codex itself. */
export function chatCodexTestCapabilities(acp?: AcpOptions['acp']): CapabilityDefinition[] {
  return [...codexTestCapabilities(acp), chatCodexDefinition()]
}

/** `testKit` over codex's test definitions and chat-codex in an Agent Hub module. */
export function chatCodexKit({ acp, ...options }: Omit<TestKitOptions, 'product' | 'capabilities' | 'modules'> & { acp?: AcpOptions['acp'] } = {}): TestKit {
  return testKit({ ...options, product: testProduct({ capabilities: chatCodexTestCapabilities(acp), modules: [AGENT_HUB_MODULE] }) })
}
