import type { Workspace } from '@candy-mountain/platform-sdk'
import { BOT_FAMILIES } from './wire'
import { REPOSITORY_CAPABILITY_ID, REPOSITORY_PATHS } from '@candy-mountain/plugin-repository'
import { bindService, CapabilityDefinitionError, defineCapabilityDefinition, serviceKey, type ActivityEventTypeDeclaration, type CapabilityDefinition, type CapabilityRuntime, type WorkspaceDeletion, type WorkspaceFactDeclaration } from '@candy-mountain/platform-sdk/daemon'
import { botSessionRoutes, botWorkspaceAgents, createBotSessionService, type BotSessionService } from './bot-sessions'
import { teamCapability } from '@candy-mountain/cap-team'
import { ACP_CAPABILITY_ID, ACP_DECISIONS, ACP_SESSIONS } from '@candy-mountain/cap-acp'
import { CLAUDE_CODE_CAPABILITY_ID } from '@candy-mountain/plugin-claude-code'
import { CODEX_CAPABILITY_ID } from '@candy-mountain/plugin-codex'
import type { Db, SecretsStore } from '@candy-mountain/platform-daemon'
import { startSlackDecisions, type SlackDecisions, type SlackDecisionsOptions } from './slack/decisions'
import { SLACK_CAPABILITY_ID, SLACK_CONNECTIONS } from '@candy-mountain/plugin-slack'
import { slackBotSource } from './slack/bot-source'
import { startSlackHandoffs, type SlackHandoffs, type SlackHandoffsOptions } from './slack/handoffs'
import { startSlackRouter, type SlackRouter, type SlackRouterOptions, type SlackTurnEnd } from './slack/router'
import { slackRoutes } from './slack/routes'
import { createWorktreePool, resolveWorktreeSettings, startWorktreeReclaimer, type WorktreePool, type WorktreePoolOptions, type WorktreeReclaimer, type WorktreeReclaimerOptions } from './worktrees'
import { deleteProjectBots, hasWorkspaceBots } from './bots'
import { botsCapability } from './manifest'
import { botRoutes } from './bots/routes'
import { srcPath } from './package-root'
import * as botsSchema from './schema'

/** The bot session service; the thread service reaches bots through the definition's `workspaceAgents` instead. */
export const BOT_SESSIONS = serviceKey<BotSessionService>('bots.sessions')
/** Worktrees exist only for bots, so the pool and its reclaimer are this definition's and readable from it. */
export const BOT_WORKTREES = serviceKey<WorktreePool>('bots.worktrees')
export const BOT_WORKTREE_RECLAIMER = serviceKey<WorktreeReclaimer>('bots.worktree-reclaimer')
export const BOT_SLACK_ROUTER = serviceKey<SlackRouter>('bots.slack-router')
export const BOT_SLACK_DECISIONS = serviceKey<SlackDecisions>('bots.slack-decisions')
export const BOT_SLACK_HANDOFFS = serviceKey<SlackHandoffs>('bots.slack-handoffs')

/** Appended by the Slack handoffs when a bot hands its work back. */
export const BOT_ACTIVITY_EVENT_TYPES: readonly ActivityEventTypeDeclaration[] = [
  { id: 'bot.handoff', label: 'Bot handoff', icon: 'i-lucide-bot', notifications: [{ id: 'bot.finished', label: 'A bot finishes' }] },
]

/** Team requires it; the registry asks here rather than counting bots itself. */
export const BOT_WORKSPACE_FACTS: readonly WorkspaceFactDeclaration[] = [
  { id: 'hasBots', compute: (db, workspace) => hasWorkspaceBots(db, workspace.id), message: label => `The ${label.singular} has no bots yet; add one on the Bots page.` },
]

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
export function botsRoutes({ db, secrets }: BotsRoutesDeps, sessions?: BotSessionService): Pick<CapabilityRuntime, 'workspaceRoutes'> & { onWorkspaceDeleted(workspace: Workspace, deletion: WorkspaceDeletion): Promise<void> } {
  return {
    workspaceRoutes: sessions ? [botRoutes(secrets), botSessionRoutes(sessions)] : [botRoutes(secrets)],
    async onWorkspaceDeleted(workspace, deletion) {
      deleteProjectBots({ db, secrets: secrets.writeOnly }, workspace.id, deletion)
    },
  }
}

export function botsDefinition(options: BotsOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: botsCapability.id,
    manifest: botsCapability,
    schema: { schema: botsSchema, migrationsFolder: srcPath('migrations') },
    // No claude-code or codex service is read, but bots of each family need the family and plugin type its connection package brings; the Slack router reads the team roster.
    dependsOn: [REPOSITORY_CAPABILITY_ID, ACP_CAPABILITY_ID, CLAUDE_CODE_CAPABILITY_ID, CODEX_CAPABILITY_ID, SLACK_CAPABILITY_ID, teamCapability.id],
    provides: [BOT_SESSIONS, BOT_WORKTREES, BOT_WORKTREE_RECLAIMER, BOT_SLACK_ROUTER, BOT_SLACK_DECISIONS, BOT_SLACK_HANDOFFS],
    activityEventTypes: BOT_ACTIVITY_EVENT_TYPES,
    workspaceFacts: BOT_WORKSPACE_FACTS,
    start({ db, paths, secrets, pluginTypes, families, scopeUrlPrefix, service }) {
      // BOT_FAMILIES is still a closed list, so a product that drops one of them must fail here rather than at the first bot.
      for (const family of BOT_FAMILIES) {
        if (!families.has(family)) throw new CapabilityDefinitionError(`Capability '${botsCapability.id}': bot family '${family}' is not a registered session family.`)
      }
      const repository = service(REPOSITORY_PATHS)
      const worktreeOptions = { ...resolveWorktreeSettings(), ...options.worktrees }
      const worktrees = createWorktreePool({ db, paths, repository }, worktreeOptions)
      const sessions = service(ACP_SESSIONS)
      const slack = service(SLACK_CONNECTIONS)
      slack.attach(slackBotSource({ db, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets }))
      const botSessions = createBotSessionService({ db, paths, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets, sessions, worktrees, repository })
      const reclaimer = startWorktreeReclaimer({ db, paths, pool: worktrees, repository }, worktreeOptions)
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
          bindService(BOT_WORKTREES, worktrees),
          bindService(BOT_WORKTREE_RECLAIMER, reclaimer),
          bindService(BOT_SLACK_ROUTER, slackRouter),
          bindService(BOT_SLACK_DECISIONS, slackDecisions),
          bindService(BOT_SLACK_HANDOFFS, slackHandoffs),
        ],
        ...routes,
        async onWorkspaceDeleted(workspace, deletion) {
          // Read now: the repository row goes with the workspace.
          const clone = repository.find(workspace.id)
          await routes.onWorkspaceDeleted(workspace, deletion)
          deletion.afterCommit(() => worktrees.removeProject(workspace.id, clone))
        },
        workspaceAgents: botWorkspaceAgents({ db, pluginTypes, secrets: secrets.writeOnly }, botSessions),
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
