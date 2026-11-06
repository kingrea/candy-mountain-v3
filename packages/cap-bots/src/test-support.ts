import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import { vi } from 'vitest'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, chatClaudeCodeDefinition, type AcpHarness, type ChatClaudeCodeOptions, type DecisionService, type SessionManager } from '@candy-mountain/cap-chat-claude-code'
import { chatCodexDefinition } from '@candy-mountain/cap-chat-codex'
import { createWorkspaceWithRepository, fakeHosts, repositoryDefinition, type FakeHandler } from '@candy-mountain/cap-repository'
import { slackDefinition, type SlackOptions } from '@candy-mountain/cap-slack'
import { teamDefinition } from '@candy-mountain/cap-team'
import type { CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { createActivityEventTypeRegistry, declaredActivityEventTypes, instanceHarness as platformInstanceHarness, openTestDatabase, overviewDefinition, platformDefinitions, startPlatform, testProduct, type AnyPluginType, type InstanceHarness, type InstanceHarnessOptions, type Platform, type PlatformDatabase, type PlatformOptions, type Product } from '@candy-mountain/platform-daemon'
import { BOT_SESSIONS, BOT_WORKTREES, botsDefinition, type BotsOptions } from './definition'
import type { BotSessionService } from './bot-sessions'
import type { WorktreePool } from './worktrees'

export { GOOD_TOKEN, hostJson as json } from '@candy-mountain/cap-repository'

/** Stubs global fetch with the repository package's fake GitHub and Bitbucket; tests restore it with vi.unstubAllGlobals(). */
export function stubHosts(override?: FakeHandler) {
  const { requests, fetch } = fakeHosts(override)
  const fetchMock = vi.fn(fetch)
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
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
    { capabilityId: 'chat-codex', defaultRung: 'chat' },
  ],
}

export interface BotsTestOptions extends ChatClaudeCodeOptions, BotsOptions {
  slack?: SlackOptions
}

/** Everything bots depends on, in the order a product lists them; the overview is included so the registry's view order is a product's. */
export function botsTestCapabilities({ acp, sessions, decisions, worktrees, slackRouter, slackDecisions, slackHandoffs, slack }: BotsTestOptions = {}): CapabilityDefinition[] {
  return [overviewDefinition(), repositoryDefinition(), slackDefinition(slack), botsDefinition({ worktrees, slackRouter, slackDecisions, slackHandoffs }), teamDefinition(), chatClaudeCodeDefinition({ acp, sessions, decisions }), chatCodexDefinition()]
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

/** The services the chat-claude-code and bots definitions offer; throws when the platform started without either. */
export function botsServices(platform: Pick<Platform, 'runtime'>): BotsServices {
  const sessions = platform.runtime.service(ACP_SESSIONS)
  const decisions = platform.runtime.service(ACP_DECISIONS)
  const acpHarness = platform.runtime.service(ACP_HARNESS)
  if (!sessions || !decisions || !acpHarness) throw new Error('The platform started without the chat-claude-code definition.')
  const botSessions = platform.runtime.service(BOT_SESSIONS)
  const worktrees = platform.runtime.service(BOT_WORKTREES)
  if (!botSessions || !worktrees) throw new Error('The platform started without the bots definition.')
  return { sessions, decisions, acpHarness, botSessions, worktrees }
}

export type BotsPlatform = Platform & BotsServices

export type BotsPlatformOptions = Omit<PlatformOptions, 'product'> & BotsTestOptions

/** `startPlatform` over `botsTestProduct` with the given options, the ACP and bot services pulled out for tests. */
export function startBotsPlatform(dataDir: string, { acp, sessions, decisions, worktrees, slackRouter, slackDecisions, slackHandoffs, slack, ...options }: BotsPlatformOptions = {}): BotsPlatform {
  const platform = startPlatform(dataDir, { product: botsTestProduct({ acp, sessions, decisions, worktrees, slackRouter, slackDecisions, slackHandoffs, slack }), ...options })
  return { ...platform, ...botsServices(platform) }
}
