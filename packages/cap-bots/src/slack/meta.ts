import { eq, inArray, like, sql } from 'drizzle-orm'
import { type Db, platformMeta } from '@crab-shack/platform-daemon'
import { slackDeliveries, slackThreads, slackTurns } from '../schema'

/** Survives a restart so a message whose decision died with the daemon still gets its outcome. */
export const SLACK_DECISION_META_PREFIX = 'slack-decision:'
export const slackDecisionMetaKey = (decisionId: string) => `${SLACK_DECISION_META_PREFIX}${decisionId}`

const SLACK_HANDOFF_META_PREFIX = 'slack-handoff:'
/** Only for the card a turn without a message had to post; a message that exists is edited instead. */
export const slackHandoffMetaKey = (turnId: string) => `${SLACK_HANDOFF_META_PREFIX}${turnId}`

function postedBotId(value: string): unknown {
  try {
    return (JSON.parse(value) as { botId?: unknown } | null)?.botId
  }
  catch {
    return undefined
  }
}

/** Call before deleting bots: their deliveries and meta keys name a bot, decision or turn, never by foreign key, so nothing cascades to them. */
export function deleteBotSlackState(db: Db, botIds: readonly string[]): void {
  if (!botIds.length) return
  db.delete(slackDeliveries).where(inArray(slackDeliveries.botId, botIds)).run()
  const handoffKeys = db.select({ key: sql<string>`${SLACK_HANDOFF_META_PREFIX} || ${slackTurns.id}` })
    .from(slackTurns)
    .innerJoin(slackThreads, eq(slackThreads.id, slackTurns.threadId))
    .where(inArray(slackThreads.botId, botIds))
  db.delete(platformMeta).where(inArray(platformMeta.key, handoffKeys)).run()
  const ids = new Set<unknown>(botIds)
  const decisionKeys = db.select().from(platformMeta).where(like(platformMeta.key, `${SLACK_DECISION_META_PREFIX}%`)).all()
    .filter(row => ids.has(postedBotId(row.value)))
    .map(row => row.key)
  if (decisionKeys.length) db.delete(platformMeta).where(inArray(platformMeta.key, decisionKeys)).run()
}
