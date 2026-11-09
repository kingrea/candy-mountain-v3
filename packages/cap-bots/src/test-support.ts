import type { CreateWorkspaceRequest, ModuleDefinition, Workspace } from '@crab-shack/platform-sdk'
import { vi } from 'vitest'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, acpDefinition, type AcpHarness, type AcpOptions, type DecisionService, type SessionManager } from '@candy-mountain/cap-acp'
import { claudeCodeDefinition } from '@candy-mountain/plugin-claude-code'
import { codexDefinition } from '@candy-mountain/plugin-codex'
import { repositoryDefinition, setRepository } from '@candy-mountain/plugin-repository'
import { fakeHosts, type FakeHandler } from '@candy-mountain/testing'
import { slackDefinition, type SlackOptions } from '@candy-mountain/plugin-slack'
import { teamDefinition } from '@candy-mountain/cap-team'
import { defineCapability, defineCapabilityDefinition, type CapabilityDefinition } from '@crab-shack/platform-sdk/daemon'
import { createActivityEventTypeRegistry, createWorkspace, declaredActivityEventTypes, overviewDefinition, platformDefinitions, type AnyPluginType, type Db, type Platform, type PlatformDatabase, type Product } from '@crab-shack/platform-daemon'
import { instanceHarness as platformInstanceHarness, openTestDatabase, testKit, testProduct, type InstanceHarness, type InstanceHarnessOptions, type TestKit, type TestKitOptions } from '@crab-shack/platform-daemon/testing'
import { BOT_SESSIONS, BOT_WORKTREES, botsDefinition, type BotsOptions } from './definition'
import type { BotSessionService } from './bot-sessions'
import type { WorktreePool } from './worktrees'

export { GOOD_TOKEN, hostJson as json } from '@candy-mountain/testing'

/** A workspace whose repository is the existing directory at `path`. */
export async function createWorkspaceWithRepository(db: Db, { path, ...input }: CreateWorkspaceRequest & { path: string }): Promise<Workspace> {
  const workspace = createWorkspace(db, input)
  await setRepository(db, workspace.id, { kind: 'local-path', path })
  return workspace
}

/** Stubs global fetch with a fake GitHub and Bitbucket; tests restore it with vi.unstubAllGlobals(). */
export function stubHosts(override?: FakeHandler) {
  const { requests, fetch } = fakeHosts(override)
  const fetchMock = vi.fn(fetch)
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

/** What chat-claude-code contributes without importing it: the agent whose family gates a Claude Code bot's threads. */
const chatClaudeCodeStandInCapability = defineCapability({
  id: 'chat-claude-code',
  label: 'Chat with Claude Code',
  description: 'Stands in for chat-claude-code, registered the way it shows Claude Code in the chat rail.',
  views: [],
  agents: [{ id: 'claude-code', label: 'Claude Code', description: 'Claude Code over the fake claude.', family: 'claude-code', avatar: 'i-lucide-sparkles' }],
  jobs: [],
  requiresPlugins: ['claude-code'],
  tools: [],
  ladder: [
    { name: 'none', label: 'None', description: 'Claude Code does not appear in the chat rail.', views: [], chat: false, tools: {} },
    { name: 'chat', label: 'Chat', description: 'Start and continue threads with Claude Code.', views: [], chat: true, tools: {} },
  ],
})

export function chatClaudeCodeStandInDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({ id: chatClaudeCodeStandInCapability.id, manifest: chatClaudeCodeStandInCapability, dependsOn: ['acp', 'claude-code'] })
}

/** The module bots and team sit in under a product, with the chat capabilities the bot families need. */
export const AGENT_HUB_MODULE: ModuleDefinition = {
  id: 'agent-hub',
  label: 'Agent Hub',
  description: 'Chat with coding agents and run bots for the project.',
  icon: 'i-lucide-bot',
  capabilities: [
    { capabilityId: 'bots', defaultRung: 'manage' },
    { capabilityId: 'team', defaultRung: 'manage' },
    { capabilityId: 'chat-claude-code', defaultRung: 'chat' },
  ],
}

export interface BotsTestOptions extends AcpOptions, BotsOptions {
  slack?: SlackOptions
}

/** Everything bots depends on, in the order a product lists them; the overview is included so the registry's view order is a product's. */
export function botsTestCapabilities({ acp, sessions, decisions, worktrees, slackRouter, slackDecisions, slackHandoffs, slack }: BotsTestOptions = {}): CapabilityDefinition[] {
  return [overviewDefinition(), repositoryDefinition(), slackDefinition(slack), botsDefinition({ worktrees, slackRouter, slackDecisions, slackHandoffs }), teamDefinition(), acpDefinition({ acp, sessions, decisions }), claudeCodeDefinition(), chatClaudeCodeStandInDefinition(), codexDefinition()]
}

/** The product the tests boot, without the capability ids in `without` (and with the module trimmed to match). */
export function botsTestProduct(options: BotsTestOptions = {}, without: readonly string[] = []): Product {
  const gone = new Set(without)
  const modules = [AGENT_HUB_MODULE].map(m => ({ ...m, capabilities: m.capabilities.filter(c => !gone.has(c.capabilityId)) })).filter(m => m.capabilities.length > 0)
  return testProduct({ capabilities: botsTestCapabilities(options).filter(c => !gone.has(c.id)), modules })
}

/** Every table the test product owns, with its activity event types registered. */
export const openBotsDatabase = (): PlatformDatabase => openTestDatabase({ definitions: botsTestCapabilities() })

/** The test product's types as its platform registers them. */
export const testActivityEventTypes = () => createActivityEventTypeRegistry(declaredActivityEventTypes([...platformDefinitions(), ...botsTestCapabilities()]))

/** The platform's harness serving the test product over its tables, its workspaces carrying a repository so bots can be exercised. */
export function instanceHarness(types: readonly AnyPluginType[], options: Omit<InstanceHarnessOptions, 'createWorkspace' | 'openDatabase' | 'product'> = {}): InstanceHarness {
  return platformInstanceHarness(types, { ...options, product: botsTestProduct(), openDatabase: openBotsDatabase, createWorkspace: createWorkspaceWithRepository })
}

export interface BotsServices {
  sessions: SessionManager
  decisions: DecisionService
  acpHarness: AcpHarness
  botSessions: BotSessionService
  worktrees: WorktreePool
}

/** The services the acp and bots definitions offer; throws when the platform started without either. */
export function botsServices(platform: Pick<Platform, 'runtime'>): BotsServices {
  const sessions = platform.runtime.service(ACP_SESSIONS)
  const decisions = platform.runtime.service(ACP_DECISIONS)
  const acpHarness = platform.runtime.service(ACP_HARNESS)
  if (!sessions || !decisions || !acpHarness) throw new Error('The platform started without the acp definition.')
  const botSessions = platform.runtime.service(BOT_SESSIONS)
  const worktrees = platform.runtime.service(BOT_WORKTREES)
  if (!botSessions || !worktrees) throw new Error('The platform started without the bots definition.')
  return { sessions, decisions, acpHarness, botSessions, worktrees }
}

export type BotsKit = TestKit & BotsServices

export type BotsKitOptions = Omit<TestKitOptions, 'product' | 'capabilities' | 'modules' | 'pluginTypes'> & BotsTestOptions

function splitOptions({ acp, sessions, decisions, worktrees, slackRouter, slackDecisions, slackHandoffs, slack, ...kitOptions }: BotsKitOptions) {
  const bots = Object.fromEntries(Object.entries({ acp, sessions, decisions, worktrees, slackRouter, slackDecisions, slackHandoffs, slack }).filter(([, value]) => value !== undefined)) as BotsTestOptions
  return { bots, kitOptions }
}

const withBotsServices = (kit: TestKit): BotsKit => Object.assign(kit, botsServices(kit.platform))

/** `testKit` over `botsTestProduct` with the given options, the ACP and bot services pulled out for tests. */
export function botsKit(options: BotsKitOptions = {}): BotsKit {
  const { bots, kitOptions } = splitOptions(options)
  return withBotsServices(testKit({ ...kitOptions, product: botsTestProduct(bots) }))
}

/** `kit.restart` with the services pulled out again; bots options, when any are given, replace the first kit's. */
export async function restartBots(kit: BotsKit, options: BotsKitOptions = {}): Promise<BotsKit> {
  const { bots, kitOptions } = splitOptions(options)
  return withBotsServices(await kit.restart(Object.keys(bots).length ? { ...kitOptions, product: botsTestProduct(bots) } : kitOptions))
}
