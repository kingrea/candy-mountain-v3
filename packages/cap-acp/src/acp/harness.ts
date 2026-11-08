import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { curateAgentEnv } from './env'
import type { AcpEventListener, AgentFamily } from './events'
import { AcpLaunchError, resolveFamilyLaunch, type CodexLaunchOptions, type FamilyBins, type LaunchMcpServer } from './families'
import { AcpStartError, createAcpSessionHandle, type AcpSession, type AcpSessionHandle } from './session'

export interface StartSessionOptions {
  family: AgentFamily
  /** Absolute checkout or worktree the agent works in. */
  cwd: string
  /** Absolute per-plugin login home: CLAUDE_CONFIG_DIR for Claude Code, CODEX_HOME for Codex. */
  configHome: string
  /** Extra child variables on top of the allowlist, denylist-checked; for Codex the launcher's own variables are refused too. */
  env?: Record<string, string>
  /** Claude posture flags forwarded verbatim after `--`; refused for Codex, whose posture is `codex`. */
  flags?: string[]
  /** Codex posture: defaults to read-only mode with user-reviewed approvals and no developer instructions. */
  codex?: CodexLaunchOptions
  mcpServers?: readonly LaunchMcpServer[]
  /** CLI executable override: the claude binary, or the codex binary (CODEX_PATH). */
  command?: string
  /** Continue an earlier conversation instead of starting one. */
  upstreamSessionId?: string
  /** Attached before the handshake, so a loaded session's replayed history is seen too. */
  onEvent?: AcpEventListener
  turnTimeoutMs?: number
}

export interface AcpHarnessOptions {
  /** Base environment the allowlist is applied to; defaults to the daemon's own. */
  env?: NodeJS.ProcessEnv
  bins?: FamilyBins
  startTimeoutMs?: number
  killTimeoutMs?: number
  onDiagnostic?: (session: { id: string, family: AgentFamily }, text: string) => void
}

export interface AcpHarness {
  startSession(options: StartSessionOptions): Promise<AcpSession>
  list(): AcpSession[]
  get(id: string): AcpSession | undefined
  readonly closed: boolean
  /** Kills every live session and refuses new ones; idempotent. */
  close(): Promise<void>
}

/** Owner-only like the rest of the data directory; a symlink could point the CLI at someone else's login. */
function prepareConfigHome(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stats = lstatSync(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new AcpLaunchError(`${path} must be a real directory, not a symbolic link`)
  chmodSync(path, 0o700)
}

export function createAcpHarness(options: AcpHarnessOptions = {}): AcpHarness {
  const sessions = new Map<string, AcpSessionHandle>()
  let closed = false

  return {
    async startSession(start) {
      if (closed) throw new Error('The ACP harness is closed')
      if (!isAbsolute(start.cwd)) throw new AcpStartError(start.family, 'cwd must be an absolute path')
      const launch = resolveFamilyLaunch(start.family, { configHome: start.configHome, flags: start.flags, command: start.command, turnTimeoutMs: start.turnTimeoutMs, env: start.env, codex: start.codex, mcpServers: start.mcpServers }, options.bins)
      const env = curateAgentEnv({ base: options.env, extra: start.env })
      prepareConfigHome(start.configHome)
      const session = createAcpSessionHandle({
        family: start.family,
        cwd: start.cwd,
        configHome: start.configHome,
        launch,
        env,
        upstreamSessionId: start.upstreamSessionId,
        onEvent: start.onEvent,
        onStderr: options.onDiagnostic ? text => options.onDiagnostic!({ id: session.id, family: start.family }, text) : undefined,
        startTimeoutMs: options.startTimeoutMs,
        killTimeoutMs: options.killTimeoutMs,
      })
      sessions.set(session.id, session)
      void session.exited.then(() => sessions.delete(session.id))
      await session.start()
      return session
    },
    list() {
      return [...sessions.values()].filter(session => session.status !== 'starting')
    },
    get(id) {
      const session = sessions.get(id)
      return session && session.status !== 'starting' ? session : undefined
    },
    get closed() {
      return closed
    },
    async close() {
      closed = true
      await Promise.all([...sessions.values()].map(session => session.close()))
    },
  }
}
