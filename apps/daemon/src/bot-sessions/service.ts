import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BOT_FAMILY_NAMES, botAgentId, botPersonaPath, type AgentSession, type AgentSessionPosture, type Bot, type BotSessionHolder, type BotSessionWarning, type ChatThread } from '@candy-mountain/shared'
import { and, desc, sql } from 'drizzle-orm'
import { SLACK_POST_BLOCKS_TOOL } from '../agent-mcp/tools'
import { assertBotPersonaBeforeSession, BotError, getBot, surfaceInstructionsForBot, type BotReadDeps } from '../bots'
import type { DataPaths } from '../data-dir'
import type { Db } from '../db'
import { agentSessions } from '../db/schema'
import { resolvePluginInstance, type PluginInstanceDeps, type SecretsReader } from '../plugins/instances/instances'
import { assertPostureNotWidened, CLAUDE_SANDBOX_DEFAULT_WRITE_PATHS, PostureError, resolveBotPosture, type NeutralisedItem } from '../posture'
import { findProjectById, sourcePath } from '../projects/projects'
import { SessionError, type SessionManager } from '../sessions'
import { findThread, insertThread, switchThreadSession } from '../threads/store'
import { beadsEnvForWorktree, botBranchName, dependencyInstallState, WorktreeError, type WorktreeLease, type WorktreePool } from '../worktrees'
import { BotStartError } from './errors'

export interface BotSessionDeps extends PluginInstanceDeps {
  paths: DataPaths
  secretsReader: SecretsReader
  sessions: SessionManager
  worktrees: WorktreePool
}

export interface BotSessionServiceOptions {
  now?: () => number
  onDiagnostic?: (message: string) => void
}

export interface StartBotSessionInput {
  botId: string
  holder: BotSessionHolder
  actorId: string
  signal?: AbortSignal
}

export interface BotSessionStart {
  bot: Bot
  session: AgentSession
  lease: WorktreeLease
  /** The console thread holding the session; null for a Slack holder. */
  thread: ChatThread | null
  /** True when the holder already had a session and its worktree was resumed. */
  resumed: boolean
  /** Checkout settings and agent files the posture outranked; empty on a resume. */
  neutralised: NeutralisedItem[]
  warnings: BotSessionWarning[]
}

export interface BotSessionClose {
  session: AgentSession
  lease: WorktreeLease | null
  released: boolean
  keptUnpushed: boolean
}

export interface BotSessionService {
  /** The holder's running session, or a new one: persona, plugin health, worktree, posture, instructions, bd routing. */
  start(input: StartBotSessionInput): Promise<BotSessionStart>
  /** Keeps the worktree lease fresh and sends the turn. */
  prompt(sessionId: string, text: string): Promise<AgentSession>
  /** Cancels a running turn and releases the worktree under the safe-reclaim rule; null when the holder has no session. */
  close(holder: BotSessionHolder): Promise<BotSessionClose | null>
  closeSession(sessionId: string): Promise<BotSessionClose | null>
  /** The newest session created for the holder, whatever its lease state. */
  find(holder: BotSessionHolder): AgentSession | null
  /** A bot session by id; null for any other session. */
  get(sessionId: string): AgentSession | null
  /** The session's worktree lease, released ones included. */
  lease(sessionId: string): WorktreeLease | null
  stop(): void
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const sessionHolder = (sessionId: string) => ({ kind: 'session' as const, id: sessionId })

function warningsOf(lease: WorktreeLease): BotSessionWarning[] {
  if (lease.dependencies?.status !== 'failed') return []
  return [{ reason: 'dependencies_failed', message: `Installing dependencies in the worktree failed; the bot was told.${lease.dependencies.output ? `\n${lease.dependencies.output}` : ''}` }]
}

function holderSessionIds(db: Db, holder: BotSessionHolder, botId?: string): string[] {
  const kind = sql`json_extract(${agentSessions.posture}, '$.bot.holder.kind') = ${holder.kind}`
  const id = sql`json_extract(${agentSessions.posture}, '$.bot.holder.id') = ${holder.id}`
  const where = botId === undefined ? and(kind, id) : and(kind, id, sql`json_extract(${agentSessions.posture}, '$.bot.id') = ${botId}`)
  return db.select({ id: agentSessions.id }).from(agentSessions).where(where).orderBy(desc(agentSessions.createdAt), desc(agentSessions.id)).all().map(row => row.id)
}

export function createBotSessionService(deps: BotSessionDeps, options: BotSessionServiceOptions = {}): BotSessionService {
  const { db, sessions, worktrees } = deps
  const now = () => new Date((options.now ?? Date.now)()).toISOString()
  const diagnostic = options.onDiagnostic ?? (() => {})
  const readDeps: BotReadDeps = { db, pluginTypes: deps.pluginTypes, secrets: deps.secrets, secretsReader: deps.secretsReader }
  const prompting = new Set<string>()

  // Prompts can arrive on the plain session routes too; the lease must still look used so the reclaimer leaves it.
  const unobserve = sessions.observe((sessionId, message) => {
    if (message.type !== 'event' || message.event.kind !== 'prompt' || prompting.has(sessionId)) return
    if (!sessions.get(sessionId)?.posture?.bot) return
    worktrees.resume(sessionHolder(sessionId)).catch(error => diagnostic(`bot session ${sessionId}: ${errorMessage(error)}`))
  })

  const find = (holder: BotSessionHolder, botId?: string): AgentSession | null => {
    const id = holderSessionIds(db, holder, botId)[0]
    return id ? sessions.get(id) : null
  }

  const leaseOf = (session: AgentSession): WorktreeLease | null =>
    worktrees.list(session.projectId).find(lease => lease.holder.kind === 'session' && lease.holder.id === session.id) ?? null

  function assertPluginHealthy(bot: Bot): void {
    const health = resolvePluginInstance(deps, bot.projectId, bot.family)?.health
    if (health?.healthy) return
    const name = BOT_FAMILY_NAMES[bot.family]
    const why = health === undefined ? 'is not set up for this project' : health === null ? 'has not been tested since it last changed' : `is unhealthy: ${health.reason}`
    throw new BotStartError('plugin_unhealthy', `Bot "${bot.name}" cannot start because the ${name} plugin ${why}`)
  }

  async function assertPersona(bot: Bot, signal?: AbortSignal): Promise<void> {
    try {
      await assertBotPersonaBeforeSession(readDeps, bot, { signal })
    }
    catch (error) {
      if (!(error instanceof BotError)) throw error
      const reason = error.code === 'persona_missing' || error.code === 'persona_not_set'
        ? 'persona_missing'
        : error.code === 'repository_not_configured' ? 'repository_not_configured' : 'persona_check_failed'
      throw new BotStartError(reason, error.message, { cause: error })
    }
  }

  async function acquireLease(bot: Bot, sessionId: string, baseBranch: string): Promise<WorktreeLease> {
    try {
      return await worktrees.acquire({ projectId: bot.projectId, holder: sessionHolder(sessionId), baseBranch, branchName: botBranchName(bot.name, sessionId) })
    }
    catch (error) {
      if (!(error instanceof WorktreeError)) throw error
      if (error.code === 'cap_reached') throw new BotStartError('worktree_cap', `Bot "${bot.name}" cannot start: ${error.message}`, { cause: error })
      throw new BotStartError('worktree_failed', `Bot "${bot.name}" cannot start: ${error.message}`, { cause: error })
    }
  }

  /** The worktree is the persona's source of truth once checked out: `--agent` reads the same file. */
  async function readPersona(bot: Bot, personaName: string, worktree: string): Promise<string> {
    const path = botPersonaPath(bot.family, personaName)
    try {
      return await readFile(join(worktree, path), 'utf8')
    }
    catch (error) {
      throw new BotStartError('persona_missing', `Bot "${bot.name}" cannot start: ${path} is not in the worktree cut from ${bot.effectiveBaseBranch}`, { cause: error })
    }
  }

  function consoleThread(bot: Bot, threadId: string, actorId: string, session: AgentSession): ChatThread {
    const at = now()
    const existing = findThread(db, threadId)
    if (existing) {
      switchThreadSession(db, threadId, { sessionId: session.id, model: null, effort: null, createdAt: at }, { working: false, lastActivityAt: at, updatedAt: at })
      return findThread(db, threadId)!
    }
    return insertThread(db, {
      id: threadId,
      projectId: bot.projectId,
      actorId,
      agentId: botAgentId(bot.id),
      currentSessionId: session.id,
      title: bot.name,
      model: null,
      effort: null,
      unread: false,
      working: false,
      lastReadAt: null,
      lastActivityAt: at,
      createdAt: at,
      updatedAt: at,
    }, { sessionId: session.id, model: null, effort: null, createdAt: at })
  }

  async function startNew(bot: Bot, holder: BotSessionHolder, actorId: string, signal?: AbortSignal): Promise<BotSessionStart> {
    await assertPersona(bot, signal)
    const personaName = bot.persona.name!
    const baseBranch = bot.effectiveBaseBranch
    if (!baseBranch) throw new BotStartError('repository_not_configured', `Bot "${bot.name}" cannot start: the repository's default branch could not be read`)
    const project = findProjectById(db, bot.projectId)
    if (!project) throw new BotError('not_found', `No project with id "${bot.projectId}"`)
    const mainCheckout = sourcePath(project.source)

    const sessionId = randomUUID()
    const lease = await acquireLease(bot, sessionId, baseBranch)
    try {
      const personaText = await readPersona(bot, personaName, lease.path)
      const beads = await beadsEnvForWorktree(mainCheckout)
      const surfaceInstructions = surfaceInstructionsForBot(deps, bot, {
        branch: lease.branch,
        baseBranch: lease.baseBranch,
        dependenciesInstalled: dependencyInstallState(lease.dependencies),
        issueTrackerNote: beads !== null,
        holderKind: holder.kind,
      })
      let resolved
      try {
        resolved = resolveBotPosture({
          family: bot.family,
          writeScope: bot.writeScope,
          personaName,
          personaText,
          surfaceInstructions,
          checkoutDir: lease.path,
          mainCheckoutDir: mainCheckout,
          beadsDir: beads?.beadsDir,
          claude: beads ? { sandboxAllowWrite: [...CLAUDE_SANDBOX_DEFAULT_WRITE_PATHS, beads.beadsDir] } : undefined,
          mcpTools: holder.kind === 'slack' ? [SLACK_POST_BLOCKS_TOOL] : [],
        })
      }
      catch (error) {
        if (error instanceof PostureError) throw new BotStartError('posture_refused', `Bot "${bot.name}" cannot start: ${error.message}`, { cause: error })
        throw error
      }
      const env = { ...resolved.env, ...beads?.env }
      assertPostureNotWidened({ family: resolved.family, flags: resolved.flags, env, codex: resolved.codex, settingsOverrides: resolved.settingsOverrides }, bot.writeScope)
      const posture: AgentSessionPosture = {
        ...(bot.family === 'claude-code' ? { flags: resolved.flags } : { codex: resolved.codex }),
        env,
        bot: { id: bot.id, name: bot.name, holder },
      }
      const session = sessions.create({ id: sessionId, projectId: bot.projectId, family: bot.family, actorId, cwd: lease.path, posture, bot: { id: bot.id, name: bot.name } })
      const thread = holder.kind === 'console' ? consoleThread(bot, holder.id, actorId, session) : null
      return { bot, session, lease, thread, resumed: false, neutralised: resolved.neutralised, warnings: warningsOf(lease) }
    }
    catch (error) {
      await worktrees.release(lease.id).catch(releaseError => diagnostic(`bot session ${sessionId}: ${errorMessage(releaseError)}`))
      throw error
    }
  }

  async function closeSession(sessionId: string): Promise<BotSessionClose | null> {
    let session = sessions.get(sessionId)
    if (!session?.posture?.bot) return null
    if (session.status === 'prompting' || session.status === 'queued') session = await sessions.cancel(session.id)
    const lease = leaseOf(session)
    if (!lease) return { session, lease: null, released: false, keptUnpushed: false }
    const result = await worktrees.release(lease.id)
    return { session, lease: result, released: result.state === 'released', keptUnpushed: result.state === 'active' && result.unpushedWork }
  }

  return {
    async start({ botId, holder, actorId, signal }) {
      const bot = await getBot(readDeps, botId, { signal })
      assertPluginHealthy(bot)
      const existing = find(holder, bot.id)
      if (existing) {
        const lease = await worktrees.resume(sessionHolder(existing.id))
        if (lease) {
          const thread = holder.kind === 'console' ? findThread(db, holder.id) : null
          return { bot, session: existing, lease, thread, resumed: true, neutralised: [], warnings: warningsOf(lease) }
        }
      }
      return startNew(bot, holder, actorId, signal)
    },

    async prompt(sessionId, text) {
      const session = sessions.get(sessionId)
      if (!session?.posture?.bot) throw new SessionError('not_found', `No bot session with id "${sessionId}"`)
      const lease = await worktrees.resume(sessionHolder(sessionId))
      if (!lease) throw new BotStartError('worktree_released', `The worktree of bot "${session.posture.bot.name}" was released; start the bot again`)
      prompting.add(sessionId)
      try {
        return await sessions.prompt(sessionId, text)
      }
      finally {
        prompting.delete(sessionId)
      }
    },

    async close(holder) {
      const session = find(holder)
      return session ? closeSession(session.id) : null
    },

    closeSession,
    find: holder => find(holder),
    get(sessionId) {
      const session = sessions.get(sessionId)
      return session?.posture?.bot ? session : null
    },
    lease(sessionId) {
      const session = sessions.get(sessionId)
      if (!session?.posture?.bot) return null
      return worktrees.list(session.projectId, { includeReleased: true }).find(lease => lease.holder.kind === 'session' && lease.holder.id === sessionId) ?? null
    },
    stop: () => unobserve(),
  }
}
