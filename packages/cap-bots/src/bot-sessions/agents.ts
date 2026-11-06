import type { AgentSession } from '@candy-mountain/platform-sdk'
import { BOT_FAMILY_NAMES, BOT_WRITE_SCOPE_NAMES, botAgentId, botIdOfAgent, type ChatThreadBot, type RegistryAgentBot } from '../wire'
import { listWorkspaceBotRefs, type BotDeps, type ProjectBotRef } from '../bots/bots'
import type { WorkspaceAgentListing, WorkspaceAgentSource } from '@candy-mountain/platform-daemon'
import type { BotSessionService } from './service'

const agentOf = (bot: ProjectBotRef): WorkspaceAgentListing => ({
  agent: {
    id: botAgentId(bot.id),
    label: bot.name,
    description: `${BOT_FAMILY_NAMES[bot.family]} bot, ${BOT_WRITE_SCOPE_NAMES[bot.writeScope].toLowerCase()}, working in its own worktree.`,
    family: bot.family,
    avatar: 'i-lucide-bot',
    extension: { id: bot.id, writeScope: bot.writeScope, baseBranch: bot.baseBranch } satisfies RegistryAgentBot,
  },
  usable: bot.usable,
})

/** The workspace's bots as chat agents: every bot lists, whatever its status, so threads of one that lost a key still show. */
export function botWorkspaceAgents(deps: BotDeps, sessions: BotSessionService): WorkspaceAgentSource {
  const list = (workspaceId: string) => listWorkspaceBotRefs(deps, workspaceId).map(agentOf)
  const threadBot = (session: AgentSession): ChatThreadBot | undefined => {
    const bot = session.posture?.bot
    if (!bot) return undefined
    const lease = sessions.lease(session.id)
    return {
      botId: bot.id,
      name: bot.name,
      worktreePath: lease?.path ?? null,
      branch: lease?.branch ?? null,
      baseBranch: lease?.baseBranch ?? null,
      worktree: lease ? lease.state : 'none',
      keptUnpushed: lease?.state === 'active' && lease.unpushedWork,
      unpushedReason: lease?.state === 'active' ? lease.unpushedReason : null,
    }
  }
  return {
    list,
    find(workspaceId, agentId) {
      return botIdOfAgent(agentId) === null ? null : list(workspaceId).find(listing => listing.agent.id === agentId)?.agent ?? null
    },
    owns: session => session.posture?.bot !== undefined,
    async start({ agentId, threadId, actorId, signal }) {
      await sessions.start({ botId: botIdOfAgent(agentId)!, holder: { kind: 'console', id: threadId }, actorId, signal })
    },
    async prompt(sessionId, text) {
      await sessions.prompt(sessionId, text)
    },
    detail: threadBot,
    async close(sessionId) {
      const closed = await sessions.closeSession(sessionId)
      return closed && { released: closed.released }
    },
  }
}
