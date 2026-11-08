import { BOT_SESSIONS, BOT_WORKTREES, type BotSessionService, type BotsOptions, type WorktreePool } from '@candy-mountain/cap-bots'
import { candyMountainProduct } from '../candy-mountain'
import { startPlatform, type Platform, type PlatformOptions } from '@candy-mountain/platform-daemon'
import type { SlackOptions } from '@candy-mountain/plugin-slack'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, type AcpHarness, type AcpOptions, type DecisionService, type SessionManager } from '@candy-mountain/cap-acp'

export interface AcpServices {
  sessions: SessionManager
  decisions: DecisionService
  acpHarness: AcpHarness
  /** From the bots definition, which depends on acp; here so tests need no undefined check. */
  botSessions: BotSessionService
  worktrees: WorktreePool
}

/** The services the acp and bots definitions offer; throws when the platform started without either. */
export function acpServices(platform: Pick<Platform, 'runtime'>): AcpServices {
  const sessions = platform.runtime.service(ACP_SESSIONS)
  const decisions = platform.runtime.service(ACP_DECISIONS)
  const acpHarness = platform.runtime.service(ACP_HARNESS)
  if (!sessions || !decisions || !acpHarness) throw new Error('The platform started without the acp definition.')
  const botSessions = platform.runtime.service(BOT_SESSIONS)
  const worktrees = platform.runtime.service(BOT_WORKTREES)
  if (!botSessions || !worktrees) throw new Error('The platform started without the bots definition.')
  return { sessions, decisions, acpHarness, botSessions, worktrees }
}

export type AcpPlatform = Platform & AcpServices

export interface AcpPlatformOptions extends Omit<PlatformOptions, 'product'>, AcpOptions, BotsOptions {
  slack?: SlackOptions
}

/** `startPlatform` over Candy Mountain's product with acp, bots and slack carrying the given options, the ACP services pulled out for tests. */
export function startAcpPlatform(dataDir: string, { acp, sessions, decisions, worktrees, slackRouter, slackDecisions, slackHandoffs, slack, ...options }: AcpPlatformOptions = {}): AcpPlatform {
  const platform = startPlatform(dataDir, { product: candyMountainProduct({ acp: { acp, sessions, decisions }, bots: { worktrees, slackRouter, slackDecisions, slackHandoffs }, slack }), ...options })
  return { ...platform, ...acpServices(platform) }
}
