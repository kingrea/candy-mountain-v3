import type { BotSessionClose, BotSessionService } from '../bot-sessions'
import type { Db } from '../db'
import { closeSlackThread, type SlackThread } from './threads'

export function slackDoneText(result: BotSessionClose | null): string {
  if (!result?.lease) return 'Done. The session is closed.'
  if (result.released) return `Done. The worktree was released; branch \`${result.lease.branch}\` is kept.`
  if (result.keptUnpushed) return `Done. The session is closed, but the worktree was kept because it holds work that is not on origin: ${result.lease.unpushedReason ?? 'unpushed changes'}. Branch \`${result.lease.branch}\`.`
  return 'Done. The session is closed.'
}

/** What "done" does, typed or pressed: the thread stops answering and the worktree goes back only if its work is on origin; null when the daemon is closing. */
export async function closeSlackThreadSession({ db, botSessions }: { db: Db, botSessions: Pick<BotSessionService, 'closeSession'> }, thread: SlackThread, { at, signal }: { at: string, signal?: AbortSignal }): Promise<string | null> {
  closeSlackThread(db, thread.id, at)
  try {
    return slackDoneText(await botSessions.closeSession(thread.sessionId))
  }
  catch (error) {
    if (signal?.aborted) return null
    return `Done, but releasing the worktree failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
