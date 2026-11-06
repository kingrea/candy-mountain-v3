import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, chatClaudeCodeDefinition, type AcpHarness, type ChatClaudeCodeOptions, type DecisionService, type SessionManager } from '@candy-mountain/cap-chat-claude-code'
import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { startTestPlatform, testProduct, type Platform, type TestPlatformOptions } from '@candy-mountain/platform-daemon'
import { chatCodexDefinition } from './definition'

/** chat-claude-code depends on repository for checkouts; chat-codex does not, so the tests stand it in by id and service name instead of importing cap-repository. */
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

export const AGENT_HUB_MODULE: ModuleDefinition = {
  id: 'agent-hub',
  label: 'Agent Hub',
  description: 'Chat with coding agents.',
  icon: 'i-lucide-bot',
  capabilities: [
    { capabilityId: 'chat-claude-code', defaultRung: 'chat' },
    { capabilityId: 'chat-codex', defaultRung: 'chat' },
  ],
}

export const CHAT_CLAUDE_CODE_ONLY_MODULE: ModuleDefinition = { ...AGENT_HUB_MODULE, capabilities: AGENT_HUB_MODULE.capabilities.filter(c => c.capabilityId !== 'chat-codex') }

/** The definitions chat-codex boots on, with chat-codex itself unless `withCodex` is false. */
export function codexTestCapabilities(acp: ChatClaudeCodeOptions['acp'], { withCodex = true } = {}): CapabilityDefinition[] {
  return [repositoryStandInDefinition(), chatClaudeCodeDefinition({ acp }), ...(withCodex ? [chatCodexDefinition()] : [])]
}

/** `startTestPlatform` over the repository stand-in, chat-claude-code and chat-codex in an Agent Hub module. */
export function startCodexPlatform(dataDir: string, { acp, withCodex = true, ...options }: Omit<TestPlatformOptions, 'product' | 'capabilities' | 'modules'> & { acp?: ChatClaudeCodeOptions['acp'], withCodex?: boolean } = {}): Platform {
  return startTestPlatform(dataDir, {
    product: testProduct({ capabilities: codexTestCapabilities(acp, { withCodex }), modules: [withCodex ? AGENT_HUB_MODULE : CHAT_CLAUDE_CODE_ONLY_MODULE] }),
    ...options,
  })
}

export interface AcpServices {
  sessions: SessionManager
  decisions: DecisionService
  acpHarness: AcpHarness
}

/** The services the chat-claude-code definition offers; throws when the platform started without it. */
export function acpServices(platform: Pick<Platform, 'runtime'>): AcpServices {
  const sessions = platform.runtime.service(ACP_SESSIONS)
  const decisions = platform.runtime.service(ACP_DECISIONS)
  const acpHarness = platform.runtime.service(ACP_HARNESS)
  if (!sessions || !decisions || !acpHarness) throw new Error('The platform started without the chat-claude-code definition.')
  return { sessions, decisions, acpHarness }
}
