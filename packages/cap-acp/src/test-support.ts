import { join } from 'node:path'
import { repositoryDefinition } from '@candy-mountain/plugin-repository'
import type { AnyCapabilityManifest, ModuleDefinition } from '@candy-mountain/platform-sdk'
import { defineCapability, defineCapabilityDefinition, type AnyPluginType, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { definePluginType, resolvePluginInstance, SessionError, type Platform, type Product } from '@candy-mountain/platform-daemon'
import { testKit, testProduct, type ProductParts, type TestKit, type TestKitOptions } from '@candy-mountain/platform-daemon/testing'
import { assertClaudeNeverBypass, assertCodexLaunchOptions, type AcpHarness, type AgentFamily } from './acp'
import type { DecisionService } from './decisions'
import { ACP_CAPABILITY_ID, ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, acpDefinition, type AcpOptions } from './definition'
import type { SessionLauncher, SessionManager } from './sessions'

export const CLAUDE_CODE_STAND_IN_FAMILY = { id: 'claude-code', name: 'Claude Code' } as const
export const CODEX_STAND_IN_FAMILY = { id: 'codex', name: 'Codex' } as const

/** Workspace-scoped types with nothing to configure, so a test can mark an instance healthy and chat. */
export const claudeCodeStandInPluginType = definePluginType({
  id: 'claude-code',
  name: 'Claude Code',
  description: 'Stands in for the claude-code plugin type of plugin-claude-code.',
  reach: ['Run the fake claude through the shim.'],
  scopes: ['workspace'],
  singleInstance: true,
  configFields: [],
  secretFields: [],
  healthCheck: () => ({ healthy: true }),
})

export const codexStandInPluginType = definePluginType({
  id: 'codex',
  name: 'Codex',
  description: 'Stands in for the codex plugin type of plugin-codex.',
  reach: ['Run the fake ACP agent as Codex.'],
  scopes: ['workspace'],
  singleInstance: true,
  configFields: [],
  secretFields: [],
  healthCheck: () => ({ healthy: true }),
})

type StandInFamily = { id: AgentFamily, name: string }

function chatStandInCapability(id: string, family: StandInFamily, description: string): AnyCapabilityManifest {
  return defineCapability({
    id,
    label: `Chat with ${family.name}`,
    description,
    views: [],
    agents: [{ id: family.id, label: family.name, description, family: family.id, avatar: 'i-lucide-bot' }],
    jobs: [],
    requiresPlugins: [family.id],
    tools: [],
    ladder: [
      { name: 'none', label: 'None', description: `${family.name} does not appear in the chat rail.`, views: [], chat: false, tools: {} },
      { name: 'chat', label: 'Chat', description: `Start and continue threads with ${family.name}.`, views: [], chat: true, tools: {} },
    ],
  })
}

const claudeCodeStandInCapability = chatStandInCapability('chat-claude-code', CLAUDE_CODE_STAND_IN_FAMILY, 'The Claude family over the shim, registered the way chat-claude-code registers Claude Code.')
const codexStandInCapability = chatStandInCapability('chat-codex', CODEX_STAND_IN_FAMILY, 'A second ACP family over the fake agent, registered the way chat-codex registers Codex.')

/** Launches like chat-claude-code does: the workspace's plugin instance names the home, the posture carries the flags. */
const claudeCodeStandInLauncher: SessionLauncher = {
  assertPosture(posture) {
    if (posture.flags) assertClaudeNeverBypass(posture.flags)
  },
  launch(row, base, deps) {
    const instance = resolvePluginInstance(deps, row.workspaceId, 'claude-code')
    if (!instance) throw new SessionError('family_unavailable', 'The Claude Code plugin is not set up for this project.')
    return { ...base, configHome: join(deps.paths.agentHomes, 'claude-code', instance.id), env: row.posture?.env, flags: row.posture?.flags }
  },
}

/** Launches like chat-codex does: the workspace's plugin instance names the home, the posture carries the codex options. */
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

function chatStandInDefinitions(manifest: AnyCapabilityManifest, pluginType: AnyPluginType, family: StandInFamily, launcher: SessionLauncher): CapabilityDefinition[] {
  const connection = defineCapabilityDefinition({
    id: pluginType.id,
    dependsOn: [ACP_CAPABILITY_ID],
    pluginTypes: [pluginType],
    sessionFamilies: [family],
    start({ service }) {
      service(ACP_SESSIONS).registerLauncher(family.id, launcher)
      return {}
    },
  })
  return [connection, defineCapabilityDefinition({ id: manifest.id, manifest, dependsOn: [connection.id] })]
}

/** What claude-code and chat-claude-code contribute, without either: a connection on acp bringing the claude-code family, and its chat capability. */
export const claudeCodeStandInDefinitions = (): CapabilityDefinition[] => chatStandInDefinitions(claudeCodeStandInCapability, claudeCodeStandInPluginType, CLAUDE_CODE_STAND_IN_FAMILY, claudeCodeStandInLauncher)

/** What codex and chat-codex contribute, without either: a connection on acp bringing the codex family, and its chat capability. */
export const codexStandInDefinitions = (): CapabilityDefinition[] => chatStandInDefinitions(codexStandInCapability, codexStandInPluginType, CODEX_STAND_IN_FAMILY, codexStandInLauncher)

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

export interface AcpKitOptions extends Omit<TestKitOptions, 'product' | 'capabilities' | 'modules'>, AcpOptions, Pick<ProductParts, 'capabilities' | 'modules'> {}

export interface AcpKit extends TestKit, AcpServices {
  restart(options?: AcpKitOptions): Promise<AcpKit>
}

type AcpProductOptions = AcpOptions & Pick<ProductParts, 'capabilities' | 'modules'>

/** The product the tests boot: repository, acp with the given options and both chat stand-ins in the Agent Hub module. */
export function acpTestProduct({ acp, sessions, decisions, capabilities = [], modules = [] }: AcpProductOptions = {}): Product {
  return testProduct({
    capabilities: [repositoryDefinition(), acpDefinition({ acp, sessions, decisions }), ...claudeCodeStandInDefinitions(), ...codexStandInDefinitions(), ...capabilities],
    modules: [AGENT_HUB_MODULE, ...modules],
  })
}

function splitOptions({ acp, sessions, decisions, capabilities, modules, ...kit }: AcpKitOptions): [AcpProductOptions, TestKitOptions] {
  return [{ acp, sessions, decisions, capabilities, modules }, kit]
}

function withAcpServices(kit: TestKit, product: AcpProductOptions): AcpKit {
  return {
    ...kit,
    ...acpServices(kit.platform),
    async restart(options = {}) {
      const [overrides, kitOverrides] = splitOptions(options)
      const merged = { ...product, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) }
      return withAcpServices(await kit.restart({ ...kitOverrides, product: acpTestProduct(merged) }), merged)
    },
  }
}

/** `testKit` over `acpTestProduct`, the ACP services pulled out for tests. */
export function acpKit(options: AcpKitOptions = {}): AcpKit {
  const [product, kit] = splitOptions(options)
  return withAcpServices(testKit({ ...kit, product: acpTestProduct(product) }), product)
}
