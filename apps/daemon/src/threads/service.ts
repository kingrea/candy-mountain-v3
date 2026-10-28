import { randomUUID } from 'node:crypto'
import { BOTS_CAPABILITY_ID, botAgentId, botIdOfAgent, CHAT_THREAD_TITLE_MAX_LENGTH, chatThreadLink, type Actor, type AgentSession, type AgentSessionFamily, type AgentSessionStatus, type CapabilityId, type ChatThread, type ChatThreadBot, type ChatThreadCloseResponse, type ChatThreadPromptResponse, type ChatThreadResponse, type Project } from '@candy-mountain/shared'
import { and, eq, sql } from 'drizzle-orm'
import { appendActivityEvent } from '../activity'
import { BotStartError } from '../bot-sessions/errors'
import type { BotSessionService } from '../bot-sessions/service'
import type { CapabilityRegistry } from '../capabilities'
import type { Db } from '../db'
import { bots } from '../db/schema'
import { findProjectById, sourcePath } from '../projects/projects'
import type { NativeTurn, SessionManager } from '../sessions'
import { ThreadError } from './errors'
import { assertModelEffort, chatPosture, familyOptions, type FamilyOptions } from './options'
import { allThreads, findThread, insertThread, listThreads, listThreadSessions, switchThreadSession, updateThread } from './store'

export interface ChatAgent {
  id: string
  label: string
  capabilityId: CapabilityId
  family: AgentSessionFamily
  /** Set for a project bot: its threads run bot sessions in a worktree instead of the project checkout. */
  botId?: string
}

/** Registered agents that chat threads can run, in registration order. */
export function chatAgents(capabilities: CapabilityRegistry): ChatAgent[] {
  return capabilities.list().flatMap(cap => cap.agents.flatMap(agent => (agent.family ? [{ id: agent.id, label: agent.label, capabilityId: cap.id, family: agent.family }] : [])))
}

export function findChatAgent(capabilities: CapabilityRegistry, agentId: string): ChatAgent {
  const agent = chatAgents(capabilities).find(candidate => candidate.id === agentId)
  if (agent) return agent
  const exists = capabilities.list().some(cap => cap.agents.some(candidate => candidate.id === agentId))
  if (exists) throw new ThreadError('unsupported_agent', `Agent '${agentId}' does not run chat threads`)
  throw new ThreadError('not_found', `No chat agent with id '${agentId}'`)
}

const botChatAgent = (bot: { id: string, name: string, family: AgentSessionFamily }): ChatAgent =>
  ({ id: botAgentId(bot.id), label: bot.name, capabilityId: BOTS_CAPABILITY_ID, family: bot.family, botId: bot.id })

/** Every bot of the project, whatever its status, so threads of a bot that later lost a key still list. */
export function projectBotAgents(db: Db, projectId: string): ChatAgent[] {
  return db.select({ id: bots.id, name: bots.name, family: bots.family }).from(bots).where(eq(bots.projectId, projectId)).orderBy(sql`lower(${bots.name})`).all().map(botChatAgent)
}

/** A manifest agent, or a `bot:<id>` agent of this project. */
export function findThreadAgent(db: Db, capabilities: CapabilityRegistry, projectId: string, agentId: string): ChatAgent {
  const botId = botIdOfAgent(agentId)
  if (botId === null) return findChatAgent(capabilities, agentId)
  const bot = db.select({ id: bots.id, name: bots.name, family: bots.family }).from(bots).where(and(eq(bots.id, botId), eq(bots.projectId, projectId))).get()
  if (!bot) throw new ThreadError('not_found', `No chat agent with id '${agentId}'`)
  return botChatAgent(bot)
}

export interface CreateThreadInput {
  project: Project
  actorId: string
  agent: ChatAgent
  title?: string | null
  model?: string | null
  effort?: string | null
  issueIds?: readonly string[]
  signal?: AbortSignal
}

export interface UpdateThreadInput {
  title?: string
  model?: string | null
  effort?: string | null
}

export interface ThreadService {
  list(projectId: string, actorId: string, agentIds: readonly string[]): ChatThread[]
  get(id: string): ChatThread | null
  create(input: CreateThreadInput): Promise<ChatThreadResponse>
  detail(thread: ChatThread): ChatThreadResponse
  update(project: Project, thread: ChatThread, agent: ChatAgent, input: UpdateThreadInput): ChatThreadResponse
  markRead(thread: ChatThread): ChatThread
  /** Models and efforts the agent offers in this project; Codex's appear once one of its sessions has run. */
  options(project: Project, agent: ChatAgent): FamilyOptions
  prompt(thread: ChatThread, text: string, actor: Actor): Promise<ChatThreadPromptResponse>
  cancel(thread: ChatThread): Promise<ChatThreadPromptResponse>
  /** Bot threads only: ends the turn and releases the worktree unless it holds unpushed work. */
  close(thread: ChatThread): Promise<ChatThreadCloseResponse>
}

/** One turn of a thread whose family runs inside the daemon instead of through the ACP harness. */
export interface NativeFamilyTurn extends NativeTurn {
  project: Project
  actor: Actor
  thread: ChatThread
  session: AgentSession
  text: string
}
export type NativeFamilyRunner = (turn: NativeFamilyTurn) => Promise<void>
export type NativeFamilyRunners = Partial<Record<AgentSessionFamily, NativeFamilyRunner>>

export interface ThreadServiceOptions {
  now?: () => number
  /** Families prompted here rather than on the session manager's harness path. */
  native?: NativeFamilyRunners
  /** Without it, threads with a bot agent cannot start. */
  bots?: BotSessionService
}

const BUSY: ReadonlySet<AgentSessionStatus> = new Set(['queued', 'starting', 'prompting'])

export function threadTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= CHAT_THREAD_TITLE_MAX_LENGTH ? flat : `${flat.slice(0, CHAT_THREAD_TITLE_MAX_LENGTH - 1).trimEnd()}…`
}

export function createThreadService(db: Db, sessions: SessionManager, options: ThreadServiceOptions = {}): ThreadService {
  const now = () => new Date((options.now ?? Date.now)()).toISOString()
  const watches = new Map<string, { sessionId: string, stop: () => void }>()

  function sessionOf(thread: ChatThread): AgentSession {
    const session = sessions.get(thread.currentSessionId)
    if (!session) throw new ThreadError('not_found', `The session of thread '${thread.id}' is gone`)
    return session
  }

  /** Working follows the session status; a busy-to-settled change is a finished turn, which makes the thread unread. */
  function reconcile(threadId: string, markUnread = true): void {
    const thread = findThread(db, threadId)
    const session = thread && sessions.get(thread.currentSessionId)
    if (!thread || !session) return
    const working = BUSY.has(session.status)
    if (working === thread.working) return
    const at = now()
    updateThread(db, threadId, working || !markUnread ? { working, updatedAt: at } : { working, unread: true, lastActivityAt: at, updatedAt: at })
  }

  function watch(threadId: string, sessionId: string): void {
    watches.get(threadId)?.stop()
    watches.set(threadId, { sessionId, stop: sessions.subscribe(sessionId, (message) => {
      if (message.type !== 'status') return
      // The manager passes through 'live' on its way from 'starting' to 'prompting' in one synchronous run; settle after it.
      queueMicrotask(() => {
        try {
          reconcile(threadId)
        }
        catch {
          // The database may already be closed while the daemon shuts down.
        }
      })
    }) })
  }

  /** Bot threads are also created and switched by the bot session service, outside this service. */
  function adopt(thread: ChatThread): ChatThread {
    if (watches.get(thread.id)?.sessionId === thread.currentSessionId) return thread
    watch(thread.id, thread.currentSessionId)
    reconcile(thread.id, false)
    return findThread(db, thread.id) ?? thread
  }

  function requireBots(): BotSessionService {
    if (!options.bots) throw new ThreadError('unsupported_agent', 'Bots cannot run in this daemon')
    return options.bots
  }

  function botOf(session: AgentSession): ChatThreadBot | undefined {
    const bot = session.posture?.bot
    if (!bot) return undefined
    const lease = options.bots?.lease(session.id) ?? null
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

  /** A closed bot thread has a released worktree; its next prompt starts a fresh session and worktree on the same thread. */
  async function promptBot(thread: ChatThread, session: AgentSession, text: string): Promise<void> {
    const service = requireBots()
    try {
      await service.prompt(session.id, text)
    }
    catch (error) {
      if (!(error instanceof BotStartError) || error.reason !== 'worktree_released') throw error
      const started = await service.start({ botId: session.posture!.bot!.id, holder: { kind: 'console', id: thread.id }, actorId: thread.actorId })
      watch(thread.id, started.session.id)
      await service.prompt(started.session.id, text)
    }
  }

  function startSession(project: Project, actorId: string, agent: ChatAgent, model: string | null, effort: string | null): AgentSession {
    return sessions.create({ projectId: project.id, family: agent.family, actorId, cwd: sourcePath(project.source), posture: chatPosture(agent.family, model, effort) })
  }

  function detail(thread: ChatThread): ChatThreadResponse {
    const session = sessionOf(thread)
    const bot = botOf(session)
    return { thread, session, sessions: listThreadSessions(db, thread.id), ...(bot ? { bot } : {}) }
  }
  const reload = (thread: ChatThread): ChatThread => findThread(db, thread.id) ?? thread

  for (const thread of allThreads(db)) {
    reconcile(thread.id, false)
    watch(thread.id, thread.currentSessionId)
  }

  return {
    list: (projectId, actorId, agentIds) => listThreads(db, projectId, actorId, agentIds).map(adopt),
    get(id) {
      const thread = findThread(db, id)
      return thread && adopt(thread)
    },
    detail,

    async create({ project, actorId, agent, title = null, model = null, effort = null, issueIds, signal }) {
      if (agent.botId !== undefined) {
        if (model !== null || effort !== null) throw new ThreadError('invalid_request', 'A bot runs with its own posture; model and effort cannot be chosen')
        const id = randomUUID()
        await requireBots().start({ botId: agent.botId, holder: { kind: 'console', id }, actorId, signal })
        // The first prompt names the thread, as with any agent; the rail already shows the bot's name.
        updateThread(db, id, { title })
        return detail(adopt(findThread(db, id)!))
      }
      assertModelEffort(agent.family, model, effort, sessions.configOptions(project.id, agent.family))
      const session = startSession(project, actorId, agent, model, effort)
      const at = now()
      const thread = insertThread(db, {
        id: randomUUID(),
        projectId: project.id,
        actorId,
        agentId: agent.id,
        currentSessionId: session.id,
        title,
        model,
        effort,
        unread: false,
        working: false,
        lastReadAt: null,
        lastActivityAt: at,
        createdAt: at,
        updatedAt: at,
      }, { sessionId: session.id, model, effort, createdAt: at })
      watch(thread.id, session.id)
      if (issueIds?.length) {
        appendActivityEvent(db, {
          projectId: project.id,
          type: 'run.started',
          title: `${agent.label} run: ${issueIds.join(', ')}`,
          link: chatThreadLink(project.slug, thread.id),
          payload: { threadId: thread.id, agentId: agent.id, sessionId: session.id, issueIds: [...issueIds] },
        })
      }
      return detail(thread)
    },

    update(project, thread, agent, input) {
      const at = now()
      const model = input.model === undefined ? thread.model : input.model
      const effort = input.effort === undefined ? thread.effort : input.effort
      const titlePatch = input.title === undefined ? {} : { title: input.title }
      if (model === thread.model && effort === thread.effort) {
        updateThread(db, thread.id, { ...titlePatch, updatedAt: at })
        return detail(reload(thread))
      }
      if (agent.botId !== undefined) throw new ThreadError('invalid_request', 'A bot runs with its own posture; model and effort cannot be chosen')
      if (thread.working || BUSY.has(sessionOf(thread).status)) throw new ThreadError('thread_busy', 'Wait for the turn to end or cancel it before changing the model or effort')
      assertModelEffort(agent.family, model, effort, sessions.configOptions(project.id, agent.family), thread)
      const session = startSession(project, thread.actorId, agent, model, effort)
      switchThreadSession(db, thread.id, { sessionId: session.id, model, effort, createdAt: at }, { ...titlePatch, model, effort, lastActivityAt: at, updatedAt: at })
      watch(thread.id, session.id)
      return detail(reload(thread))
    },

    options: (project, agent) => familyOptions(agent.family, sessions.configOptions(project.id, agent.family)),

    markRead(thread) {
      const at = now()
      updateThread(db, thread.id, { unread: false, lastReadAt: at, updatedAt: at })
      return reload(thread)
    },

    async prompt(thread, text, actor) {
      try {
        const session = sessionOf(thread)
        const native = options.native?.[session.family]
        if (native) {
          const project = findProjectById(db, thread.projectId)
          if (!project) throw new ThreadError('not_found', `The project of thread '${thread.id}' is gone`)
          await sessions.run(session.id, text, turn => native({ ...turn, project, actor, thread, session, text }))
        }
        else if (session.posture?.bot) {
          await promptBot(thread, session, text)
        }
        else {
          await sessions.prompt(session.id, text)
        }
      }
      finally {
        // The sender has seen this turn start, or seen why it could not.
        reconcile(thread.id)
        const at = now()
        updateThread(db, thread.id, { unread: false, lastReadAt: at, lastActivityAt: at, updatedAt: at, ...(thread.title === null ? { title: threadTitle(text) } : {}) })
      }
      const current = reload(thread)
      return { thread: current, session: sessionOf(current) }
    },

    async cancel(thread) {
      await sessions.cancel(thread.currentSessionId)
      reconcile(thread.id)
      const at = now()
      updateThread(db, thread.id, { unread: false, lastReadAt: at, updatedAt: at })
      const current = reload(thread)
      return { thread: current, session: sessionOf(current) }
    },

    async close(thread) {
      const session = sessionOf(thread)
      if (!session.posture?.bot) throw new ThreadError('unsupported_agent', 'Only bot threads hold a worktree to close')
      const closed = await requireBots().closeSession(session.id)
      reconcile(thread.id)
      const at = now()
      updateThread(db, thread.id, { unread: false, lastReadAt: at, updatedAt: at })
      const response = detail(reload(thread))
      return { ...response, bot: response.bot!, released: closed?.released ?? false, keptUnpushed: closed?.keptUnpushed ?? false }
    },
  }
}

const services = new WeakMap<SessionManager, ThreadService>()

/** One service per session manager, so building the app twice never doubles the session subscriptions. */
export function threadServiceFor(db: Db, sessions: SessionManager, options?: ThreadServiceOptions): ThreadService {
  let service = services.get(sessions)
  if (!service) {
    service = createThreadService(db, sessions, options)
    services.set(sessions, service)
  }
  return service
}
