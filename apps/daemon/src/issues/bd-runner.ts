import { execFile, type ExecFileException } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { IssueError } from './errors'

export interface BdRunOptions {
  timeoutMs?: number
}

/** Runs `bd <args> --json` in `cwd` and returns the parsed output; failures throw IssueError. */
export type BdRunner = (cwd: string, args: readonly string[], options?: BdRunOptions) => Promise<unknown>

export const BD_TIMEOUT_MS = 15_000
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const NOT_FOUND = /no issues? found matching/i

export const runBd: BdRunner = async (cwd, args, options = {}) => {
  await requireBeadsDirectory(cwd)
  const { error, stdout, stderr } = await exec(cwd, [...args, '--json'], options.timeoutMs ?? BD_TIMEOUT_MS)
  const command = `bd ${args[0] ?? ''}`.trim()

  if (error?.code === 'ENOENT') {
    throw new IssueError('tracker_unavailable', 'The bd command is not installed or not on the daemon\'s PATH')
  }
  if (error?.killed) {
    throw new IssueError('tracker_timeout', `${command} did not finish within ${options.timeoutMs ?? BD_TIMEOUT_MS}ms`)
  }

  const payload = parseJson(stdout)
  // bd reports some failures, such as an unknown id, as an error payload while exiting zero.
  const reported = errorMessage(payload)
  if (reported !== null || error) {
    const message = reported ?? (cliMessage(stderr) || `${command} exited with code ${String(error?.code)}`)
    throw new IssueError(NOT_FOUND.test(message) ? 'not_found' : 'tracker_failed', message)
  }
  if (payload === undefined) {
    throw new IssueError('tracker_failed', `${command} returned output that is not JSON`)
  }
  return payload
}

export async function requireBeadsDirectory(cwd: string): Promise<void> {
  const isDirectory = await stat(join(cwd, '.beads')).then(s => s.isDirectory(), () => false)
  // Without this check bd walks up the tree and would read whichever workspace encloses the checkout.
  if (!isDirectory) throw new IssueError('no_issue_tracker', `No .beads directory in ${cwd}; run bd init there to track issues`)
}

function exec(cwd: string, args: string[], timeout: number) {
  // BEADS_DIR or BEADS_DB in the daemon's environment would redirect every project to one workspace.
  const env: NodeJS.ProcessEnv = { ...process.env, BD_NON_INTERACTIVE: '1' }
  delete env.BEADS_DIR
  delete env.BEADS_DB
  return new Promise<{ error: ExecFileException | null, stdout: string, stderr: string }>((resolve) => {
    execFile('bd', args, { cwd, timeout, maxBuffer: MAX_OUTPUT_BYTES, env }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

function parseJson(stdout: string): unknown {
  if (stdout.trim() === '') return undefined
  try {
    return JSON.parse(stdout)
  }
  catch {
    return undefined
  }
}

function errorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const { error } = payload as { error?: unknown }
  return typeof error === 'string' && error !== '' ? error : null
}

function cliMessage(stderr: string): string {
  return stderr
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.toLowerCase().startsWith('warning:'))
    .join('\n')
    .replace(/^Error:\s*/, '')
}
