import { execFile, type ExecFileException } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { BD_TIMEOUT_MS, runBd, type BdRunner } from './bd-runner'
import { IssueError } from './errors'

export interface CommentEdit {
  issueId: string
  commentId: string
  text: string
  actor?: string
}

/** Rewrites one comment's text in the tracker's store; the caller reads it back through bd. */
export type CommentEditor = (cwd: string, edit: CommentEdit) => Promise<void>

interface DoltLocation {
  dataDir: string
  database: string
}

const LOCK_RETRIES = 8
const LOCK_RETRY_MS = 150
// The dolt CLI opens the store read-only while a bd process holds it.
const LOCKED = /read only|database is locked/i
const SAFE_NAME = /^[A-Za-z0-9_-]+$/

/** bd 1.2.2 cannot edit comments, so this updates the row in the embedded Dolt database with the dolt CLI and commits it as bd would. */
export function createDoltCommentEditor(run: BdRunner = runBd): CommentEditor {
  return async (cwd, edit) => {
    const location = await doltLocation(run, cwd)
    const sql = updateStatement(location.database, edit)
    for (let attempt = 1; ; attempt++) {
      const { error, stderr } = await dolt(location.dataDir, sql)
      if (!error) return
      if (error.code === 'ENOENT') {
        throw new IssueError('tracker_unavailable', 'Editing comments needs the dolt command on the daemon\'s PATH')
      }
      if (error.killed) throw new IssueError('tracker_timeout', `dolt did not finish within ${BD_TIMEOUT_MS}ms`)
      const message = stderr.trim() || `dolt exited with code ${String(error.code)}`
      if (!LOCKED.test(message) || attempt >= LOCK_RETRIES) throw new IssueError('tracker_failed', message)
      await sleep(LOCK_RETRY_MS * attempt)
    }
  }
}

export const editCommentInDolt: CommentEditor = createDoltCommentEditor()

async function doltLocation(run: BdRunner, cwd: string): Promise<DoltLocation> {
  const shown = await run(cwd, ['dolt', 'show']) as { data_dir?: unknown, database?: unknown, embedded?: unknown }
  if (shown.embedded !== true) {
    throw new IssueError('tracker_failed', 'Comments can only be edited when bd uses its embedded Dolt database')
  }
  const { data_dir: dataDir, database } = shown
  if (typeof dataDir !== 'string' || typeof database !== 'string' || !SAFE_NAME.test(database)) {
    throw new IssueError('tracker_failed', 'bd dolt show did not report a usable database location')
  }
  return { dataDir, database }
}

function updateStatement(database: string, edit: CommentEdit): string {
  const actor = (edit.actor ?? 'candy-mountain').replace(/[^\w.-]/g, '') || 'candy-mountain'
  const issue = edit.issueId.replace(/[^\w.-]/g, '')
  // Hex literals keep user text out of the SQL grammar entirely.
  return [
    `USE \`${database}\`;`,
    `UPDATE comments SET text = ${utf8(edit.text)} WHERE id = ${utf8(edit.commentId)} AND issue_id = ${utf8(edit.issueId)};`,
    `CALL DOLT_ADD('comments');`,
    `CALL DOLT_COMMIT('--skip-empty', '-m', 'bd: comment edit by ${actor} [${issue}]', '--author', '${actor} <${actor}@candy-mountain>');`,
  ].join('\n')
}

function utf8(value: string): string {
  return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`
}

function dolt(dataDir: string, sql: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, DOLT_DISABLE_EVENT_FLUSH: '1' }
  return new Promise<{ error: ExecFileException | null, stderr: string }>((resolve) => {
    const child = execFile('dolt', ['--data-dir', dataDir, 'sql'], { timeout: BD_TIMEOUT_MS, env }, (error, _stdout, stderr) => {
      resolve({ error, stderr })
    })
    // The statement goes on stdin because a hex-encoded comment can exceed the argument size limit.
    child.stdin?.on('error', () => {})
    child.stdin?.end(sql)
  })
}
