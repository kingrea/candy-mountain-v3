import type { AcpOptions } from '@candy-mountain/cap-acp'
import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import type { CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { startTestPlatform, testProduct, type Platform, type TestPlatformOptions } from '@candy-mountain/platform-daemon'
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

/** `startTestPlatform` over codex's test definitions and chat-codex in an Agent Hub module. */
export function startChatCodexPlatform(dataDir: string, { acp, ...options }: Omit<TestPlatformOptions, 'product' | 'capabilities' | 'modules'> & { acp?: AcpOptions['acp'] } = {}): Platform {
  return startTestPlatform(dataDir, {
    product: testProduct({ capabilities: chatCodexTestCapabilities(acp), modules: [AGENT_HUB_MODULE] }),
    ...options,
  })
}
