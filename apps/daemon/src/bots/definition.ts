import { BOT_FAMILIES, type Project } from '@candy-mountain/shared'
import { botSessionRoutes, createBotSessionService, type BotSessionService } from '../bot-sessions'
import { bindService, CapabilityDefinitionError, defineCapabilityDefinition, serviceKey, type CapabilityDefinition, type CapabilityRuntime } from '../capabilities/definition'
import { ACP_DECISIONS, ACP_SESSIONS } from '../chat-claude-code/definition'
import { chatCodexCapability } from '../chat-codex/manifest'
import type { Db } from '../db'
import type { SecretsStore } from '../secrets'
import { startSlackDecisions, type SlackDecisions, type SlackDecisionsOptions } from '../slack/decisions'
import { SLACK_CAPABILITY_ID, SLACK_CONNECTIONS } from '../slack/definition'
import { startSlackHandoffs, type SlackHandoffs, type SlackHandoffsOptions } from '../slack/handoffs'
import { startSlackRouter, type SlackRouter, type SlackRouterOptions, type SlackTurnEnd } from '../slack/router'
import { slackRoutes } from '../slack/routes'
import { THREAD_BOTS } from '../threads/bots'
import { createWorktreePool, startWorktreeReclaimer, type WorktreePool, type WorktreePoolOptions, type WorktreeReclaimer, type WorktreeReclaimerOptions } from '../worktrees'
import { deleteProjectBots } from './bots'
import { botsCapability } from './manifest'
import { botRoutes } from './routes'

/** The full bot session service; the thread service reads the narrower `THREAD_BOTS`. */
export const BOT_SESSIONS = serviceKey<BotSessionService>('bots.sessions')
/** Worktrees exist only for bots, so the pool and its reclaimer are this definition's and readable from it. */
export const BOT_WORKTREES = serviceKey<WorktreePool>('bots.worktrees')
export const BOT_WORKTREE_RECLAIMER = serviceKey<WorktreeReclaimer>('bots.worktree-reclaimer')
export const BOT_SLACK_ROUTER = serviceKey<SlackRouter>('bots.slack-router')
export const BOT_SLACK_DECISIONS = serviceKey<SlackDecisions>('bots.slack-decisions')
export const BOT_SLACK_HANDOFFS = serviceKey<SlackHandoffs>('bots.slack-handoffs')

export interface BotsOptions {
  worktrees?: WorktreePoolOptions & WorktreeReclaimerOptions
  /** Its `onTurnEnd` runs after the handoffs' own. */
  slackRouter?: SlackRouterOptions
  slackDecisions?: SlackDecisionsOptions
  slackHandoffs?: SlackHandoffsOptions
}

export interface BotsRoutesDeps {
  db: Db
  secrets: SecretsStore
}

/** The routes and the deletion hook without the services; without a session service only the bot routes are answered. */
export function botsRoutes({ db, secrets }: BotsRoutesDeps, sessions?: BotSessionService): Pick<CapabilityRuntime, 'workspaceRoutes'> & { onWorkspaceDeleted(workspace: Project): Promise<void> } {
  return {
    workspaceRoutes: sessions ? [botRoutes(secrets), botSessionRoutes(sessions)] : [botRoutes(secrets)],
    async onWorkspaceDeleted(workspace) {
      deleteProjectBots({ db, secrets: secrets.writeOnly }, workspace.id)
    },
  }
}

export function botsDefinition(options: BotsOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: botsCapability.id,
    manifest: botsCapability,
    // No codex service is read, but codex bots need the family and plugin type chat-codex brings.
    dependsOn: ['chat-claude-code', chatCodexCapability.id, SLACK_CAPABILITY_ID],
    provides: [BOT_SESSIONS, THREAD_BOTS, BOT_WORKTREES, BOT_WORKTREE_RECLAIMER, BOT_SLACK_ROUTER, BOT_SLACK_DECISIONS, BOT_SLACK_HANDOFFS],
    start({ db, paths, secrets, pluginTypes, families, scopeUrlPrefix, service }) {
      // BOT_FAMILIES is still a closed list, so a product that drops one of them must fail here rather than at the first bot.
      for (const family of BOT_FAMILIES) {
        if (!families.has(family)) throw new CapabilityDefinitionError(`Capability '${botsCapability.id}': bot family '${family}' is not a registered session family.`)
      }
      const worktrees = createWorktreePool({ db, paths }, options.worktrees)
      const sessions = service(ACP_SESSIONS)
      const slack = service(SLACK_CONNECTIONS)
      const botSessions = createBotSessionService({ db, paths, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets, sessions, worktrees })
      const reclaimer = startWorktreeReclaimer({ db, paths, pool: worktrees }, options.worktrees)
      const slackDecisions = startSlackDecisions({ db, slack, decisions: service(ACP_DECISIONS), sessions }, options.slackDecisions)
      const slackHandoffs = startSlackHandoffs({ db, slack, botSessions, sessions, scopeUrlPrefix }, options.slackHandoffs)
      const onTurnEnd = async (end: SlackTurnEnd) => {
        await slackHandoffs.onTurnEnd(end)
        await options.slackRouter?.onTurnEnd?.(end)
      }
      const slackRouter = startSlackRouter({ db, slack, botSessions, sessions, interceptReply: slackDecisions.interceptReply }, { ...options.slackRouter, onTurnEnd })
      const routes = botsRoutes({ db, secrets }, botSessions)
      return {
        services: [
          bindService(BOT_SESSIONS, botSessions),
          bindService(THREAD_BOTS, botSessions),
          bindService(BOT_WORKTREES, worktrees),
          bindService(BOT_WORKTREE_RECLAIMER, reclaimer),
          bindService(BOT_SLACK_ROUTER, slackRouter),
          bindService(BOT_SLACK_DECISIONS, slackDecisions),
          bindService(BOT_SLACK_HANDOFFS, slackHandoffs),
        ],
        ...routes,
        // Ahead of the bot routes, as when the slack definition mounted it.
        workspaceRoutes: [slackRoutes(slack), ...routes.workspaceRoutes ?? []],
        close() {
          slackRouter.close()
          slackDecisions.close()
          slackHandoffs.close()
          botSessions.stop()
          reclaimer.close()
        },
      }
    },
  })
}
