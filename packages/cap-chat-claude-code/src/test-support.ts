import { join } from 'node:path'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, acpDefinition, assertCodexLaunchOptions, type AcpHarness, type AcpOptions, type DecisionService, type SessionLauncher, type SessionManager } from '@candy-mountain/cap-acp'
import { claudeCodeDefinition } from '@candy-mountain/plugin-claude-code'
import { repositoryDefinition } from '@candy-mountain/plugin-repository'
import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import { defineCapability, defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { definePluginType, resolvePluginInstance, SessionError, startPlatform, testProduct, type Platform, type PlatformOptions, type Product, type ProductParts } from '@candy-mountain/platform-daemon'
import { chatClaudeCodeDefinition } from './definition'

export const CODEX_STAND_IN_FAMILY = { id: 'codex', name: 'Codex' } as const

/** A workspace-scoped type with nothing to configure, so a test can mark an instance healthy and chat. */
export const codexStandInPluginType = definePluginType({
  id: 'codex',
  name: 'Codex',
  description: 'Stands in for the Codex plugin type of plugin-codex.',
  reach: ['Run the fake ACP agent as Codex.'],
  scopes: ['workspace'],
  singleInstance: true,
  configFields: [],
  secretFields: [],
  healthCheck: () => ({ healthy: true }),
})

const codexStandInCapability = defineCapability({
  id: 'chat-codex',
  label: 'Chat with Codex',
  description: 'A second ACP family over the fake agent, registered the way chat-codex registers Codex.',
  views: [],
  agents: [{ id: 'codex', label: 'Codex', description: 'The fake ACP agent as Codex.', family: 'codex', avatar: 'i-lucide-bot' }],
  jobs: [],
  requiresPlugins: ['codex'],
  tools: [],
  ladder: [
    { name: 'none', label: 'None', description: 'Codex does not appear in the chat rail.', views: [], chat: false, tools: {} },
    { name: 'chat', label: 'Chat', description: 'Start and continue threads with Codex.', views: [], chat: true, tools: {} },
  ],
})

/** Launches like codex does: the workspace's plugin instance names the home, the posture carries the codex options. */
const codexStandInLauncher: SessionLauncher = {
  assertPosture(posture) {
    if (posture.codex) assertCodexLaunchOptions(posture.codex)
  },
  launch(row, base, deps) {
    const instance = resolvePluginInstance(deps, row.workspaceId, 'codex')
    if (!instance) throw new SessionError('family_unavailable', 'The Codex plugin is not set up for this project.')
    return { ...base, configHome: join(deps.paths.agentHomes, 'codex', instance.id), env: row.posture?.env, codex: row.posture?.codex }
  },
}

/** What codex and chat-codex contribute, without either: a connection on acp bringing a second family, and its chat capability. */
export function codexStandInDefinitions(): CapabilityDefinition[] {
  const connection = defineCapabilityDefinition({
    id: codexStandInPluginType.id,
    dependsOn: ['acp'],
    pluginTypes: [codexStandInPluginType],
    sessionFamilies: [CODEX_STAND_IN_FAMILY],
    start({ service }) {
      service(ACP_SESSIONS).registerLauncher(CODEX_STAND_IN_FAMILY.id, codexStandInLauncher)
      return {}
    },
  })
  return [connection, defineCapabilityDefinition({ id: codexStandInCapability.id, manifest: codexStandInCapability, dependsOn: [connection.id] })]
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

export interface AcpServices {
  sessions: SessionManager
  decisions: DecisionService
  acpHarness: AcpHarness
}

/** The services the acp definition offers; throws when the platform started without it. */
export function acpServices(platform: Pick<Platform, 'runtime'>): AcpServices {
  const sessions = platform.runtime.service(ACP_SESSIONS)
  const decisions = platform.runtime.service(ACP_DECISIONS)
  const acpHarness = platform.runtime.service(ACP_HARNESS)
  if (!sessions || !decisions || !acpHarness) throw new Error('The platform started without the acp definition.')
  return { sessions, decisions, acpHarness }
}

export type AcpPlatform = Platform & AcpServices

export interface AcpPlatformOptions extends Omit<PlatformOptions, 'product'>, AcpOptions, Pick<ProductParts, 'capabilities' | 'modules'> {}

/** The product the tests boot: repository, acp with the given options, claude-code, chat-claude-code and the codex stand-in in the Agent Hub module. */
export function acpTestProduct({ acp, sessions, decisions, capabilities = [], modules = [] }: Omit<AcpPlatformOptions, keyof PlatformOptions> = {}): Product {
  return testProduct({
    capabilities: [repositoryDefinition(), acpDefinition({ acp, sessions, decisions }), claudeCodeDefinition(), chatClaudeCodeDefinition(), ...codexStandInDefinitions(), ...capabilities],
    modules: [AGENT_HUB_MODULE, ...modules],
  })
}

/** `startPlatform` over `acpTestProduct`, the ACP services pulled out for tests. */
export function startAcpPlatform(dataDir: string, { acp, sessions, decisions, capabilities, modules, ...options }: AcpPlatformOptions = {}): AcpPlatform {
  const platform = startPlatform(dataDir, { product: acpTestProduct({ acp, sessions, decisions, capabilities, modules }), ...options })
  return { ...platform, ...acpServices(platform) }
}
