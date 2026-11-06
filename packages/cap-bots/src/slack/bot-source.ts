import { BOT_SECRET_LABELS, BOT_SECRET_NAMES } from '../wire'
import type { SlackBotSource, SlackConnectionTarget } from '@candy-mountain/cap-slack'
import { eq, sql } from 'drizzle-orm'
import { resolvePluginInstance, SecretsLockedError, workspaces } from '@candy-mountain/platform-daemon'
import { botSecretOwner, computeBotStatus, createBotSecrets, type BotReadDeps } from '../bots'
import { bots } from '../schema'
import { findSlackThreadBySession, slackThreadHolderId } from './threads'

type BotRow = typeof bots.$inferSelect
type Eligibility = Omit<Extract<SlackConnectionTarget, { eligible: true }>, 'botId' | 'projectId'> | Omit<Extract<SlackConnectionTarget, { eligible: false }>, 'botId' | 'projectId'>

/**
 * The bots the slack connections serve, attached by the bots definition at start.
 * The base-branch check is skipped because a host outage should not drop Slack.
 */
export function slackBotSource(deps: BotReadDeps): SlackBotSource {
  function evaluate(row: BotRow, archived: boolean, families: Map<string, ReturnType<typeof resolvePluginInstance>>): Eligibility {
    if (archived) return { eligible: false, code: 'archived', reason: 'The project is archived.' }
    const owner = botSecretOwner(row.id)
    const secrets = Object.fromEntries(BOT_SECRET_NAMES.map(name => [name, deps.secrets.isSet(owner, name) ? 'set' : 'unset'])) as Record<(typeof BOT_SECRET_NAMES)[number], 'set' | 'unset'>
    const missing = BOT_SECRET_NAMES.filter(name => secrets[name] !== 'set')
    if (missing.length > 0) return { eligible: false, code: 'missing_keys', reason: `${missing.map(name => BOT_SECRET_LABELS[name]).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.` }

    const familyKey = `${row.projectId}:${row.family}`
    if (!families.has(familyKey)) families.set(familyKey, resolvePluginInstance(deps, row.projectId, row.family))
    const status = computeBotStatus({
      family: row.family,
      familyPlugin: families.get(familyKey) ?? null,
      persona: { name: row.personaName, status: row.personaStatus, reason: row.personaReason },
      secrets,
      baseBranchProblem: null,
    })
    if (status !== 'active') {
      const warnings = typeof status === 'object' ? status.warnings.join('; ') : 'not configured'
      return { eligible: false, code: 'inactive', reason: `The bot is not active: ${warnings}.` }
    }

    try {
      const tokens = createBotSecrets(deps.secretsReader, row.id)
      const appToken = tokens.get('slackAppToken')
      const botToken = tokens.get('slackBotToken')
      if (!appToken || !botToken) return { eligible: false, code: 'missing_keys', reason: 'Slack keys are not set.' }
      return { eligible: true, appToken, botToken }
    }
    catch (error) {
      if (error instanceof SecretsLockedError) return { eligible: false, code: 'secrets_locked', reason: 'Secrets are locked: the daemon was started without its secrets key.' }
      return { eligible: false, code: 'error', reason: `The Slack keys could not be read: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  return {
    connectionTargets() {
      const rows = deps.db.select({ bot: bots, archivedAt: workspaces.archivedAt }).from(bots).innerJoin(workspaces, eq(workspaces.id, bots.projectId)).all()
      const families = new Map<string, ReturnType<typeof resolvePluginInstance>>()
      return rows.map(({ bot, archivedAt }) => ({ botId: bot.id, projectId: bot.projectId, ...evaluate(bot, archivedAt !== null, families) }))
    },
    botToken: botId => createBotSecrets(deps.secretsReader, botId).get('slackBotToken'),
    notificationSenders: projectId => deps.db.select({ id: bots.id, name: bots.name }).from(bots).where(eq(bots.projectId, projectId)).orderBy(sql`lower(${bots.name})`, bots.createdAt).all()
      .filter(({ id }) => deps.secrets.isSet(botSecretOwner(id), 'slackBotToken')),
    threadForSession(sessionId) {
      const thread = findSlackThreadBySession(deps.db, sessionId)
      return thread && { botId: thread.botId, channelId: thread.channelId, threadTs: thread.threadTs, open: thread.state === 'open', holderId: slackThreadHolderId(thread) }
    },
  }
}
