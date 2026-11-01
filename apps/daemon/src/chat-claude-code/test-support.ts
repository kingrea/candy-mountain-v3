import type { AcpHarness } from '../acp'
import type { BotSessionService } from '../bot-sessions'
import { BOT_SESSIONS, BOT_WORKTREES, type BotsOptions } from '../bots/definition'
import { candyMountainProduct } from '../candy-mountain'
import type { DecisionService } from '../decisions'
import { startPlatform, type Platform, type PlatformOptions } from '../platform'
import type { SessionManager } from '../sessions'
import type { SlackOptions } from '../slack/definition'
import type { WorktreePool } from '../worktrees'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, type ChatClaudeCodeOptions } from './definition'

export interface AcpServices {
  sessions: SessionManager
  decisions: DecisionService
  acpHarness: AcpHarness
  /** From the bots definition, which depends on chat-claude-code; here so tests need no undefined check. */
  botSessions: BotSessionService
  worktrees: WorktreePool
}

/** The services the chat-claude-code and bots definitions offer; throws when the platform started without either. */
export function acpServices(platform: Pick<Platform, 'runtime'>): AcpServices {
  const sessions = platform.runtime.service(ACP_SESSIONS)
  const decisions = platform.runtime.service(ACP_DECISIONS)
  const acpHarness = platform.runtime.service(ACP_HARNESS)
  if (!sessions || !decisions || !acpHarness) throw new Error('The platform started without the chat-claude-code definition.')
  const botSessions = platform.runtime.service(BOT_SESSIONS)
  const worktrees = platform.runtime.service(BOT_WORKTREES)
  if (!botSessions || !worktrees) throw new Error('The platform started without the bots definition.')
  return { sessions, decisions, acpHarness, botSessions, worktrees }
}

export type AcpPlatform = Platform & AcpServices

export interface AcpPlatformOptions extends Omit<PlatformOptions, 'product'>, ChatClaudeCodeOptions, BotsOptions {
  slack?: SlackOptions
}

/** `startPlatform` over Candy Mountain's product with chat-claude-code, bots and slack carrying the given options, the ACP services pulled out for tests. */
export function startAcpPlatform(dataDir: string, { acp, sessions, decisions, worktrees, slackRouter, slackDecisions, slackHandoffs, slack, ...options }: AcpPlatformOptions = {}): AcpPlatform {
  const platform = startPlatform(dataDir, { product: candyMountainProduct({ chatClaudeCode: { acp, sessions, decisions }, bots: { worktrees, slackRouter, slackDecisions, slackHandoffs }, slack }), ...options })
  return { ...platform, ...acpServices(platform) }
}
