import { randomUUID } from 'node:crypto'
import { CHAT_THREAD_TITLE_MAX_LENGTH, chatThreadLink, type Actor, type AgentSession, type AgentSessionFamily, type AgentSessionStatus, type CapabilityId, type ChatThread, type ChatThreadCloseResponse, type ChatThreadPromptResponse, type ChatThreadResponse, type ScopeLabel, type Workspace } from '@candy-mountain/platform-sdk'
import { appendActivityEvent } from '../activity'
import type { CapabilityRegistry } from '../capabilities'
import type { NativeFamilyRunner, NativeFamilyRunners, NativeFamilyTurn } from '@candy-mountain/platform-sdk/daemon'
import type { Db } from '../db'
import { findWorkspaceById } from '../workspaces/workspaces'
import { WorkspaceAgentError, type ContributedAgent, type WorkspaceAgentRegistry, type WorkspaceAgentSource } from './agents'
import { ThreadError } from './errors'
import { assertModelEffort, chatPosture, familyOptions, type FamilyOptions } from './options'
import type { ThreadSessions } from './sessions'
import { allThreads, findThread, insertThread, listThreads, listThreadSessions, switchThreadSession, updateThread } from './store'

export interface ChatAgent {
  id: string
  label: string
  capabilityId: CapabilityId
  family: AgentSessionFamily
  /** Set for a workspace agent: its threads start and run through the capability that contributes it. */
  source?: WorkspaceAgentSource
}

/** Registered agents that chat threads can run, in registration order. */
export function chatAgents(capabilities: CapabilityRegistry): ChatAgent[] {
  return capabilities.list().flatMap(cap => cap.agents.flatMap(agent => (agent.family ? [{ id: agent.id, label: agent.label, capabilityId: cap.id, family: agent.family }] : [])))
}

/** The capability whose manifest agents run the family. */
export function familyCapability(capabilities: CapabilityRegistry, family: AgentSessionFamily): CapabilityId | undefined {
  return capabilities.list().find(cap => cap.agents.some(agent => agent.family === family))?.id
}

export function findChatAgent(capabilities: CapabilityRegistry, agentId: string): ChatAgent {
  const agent = chatAgents(capabilities).find(candidate => candidate.id === agentId)
  if (agent) return agent
  const exists = capabilities.list().some(cap => cap.agents.some(candidate => candidate.id === agentId))
  if (exists) throw new ThreadError('unsupported_agent', `Agent '${agentId}' does not run chat threads`)
  throw new ThreadError('not_found', `No chat agent with id '${agentId}'`)
}

const contributedChatAgent = ({ agent, capabilityId, source }: ContributedAgent): ChatAgent =>
  ({ id: agent.id, label: agent.label, capabilityId, family: agent.family, source })

/** Every contributed agent of the workspace, usable or not, so threads of one that later lost its footing still list. */
export function workspaceChatAgents(agents: WorkspaceAgentRegistry, workspaceId: string): ChatAgent[] {
  return agents.list(workspaceId).map(contributedChatAgent)
}

/** An agent contributed to this workspace, else a manifest agent. */
export function findThreadAgent(agents: WorkspaceAgentRegistry, capabilities: CapabilityRegistry, workspaceId: string, agentId: string): ChatAgent {
  const contributed = agents.find(workspaceId, agentId)
  return contributed ? contributedChatAgent(contributed) : findChatAgent(capabilities, agentId)
}

export interface CreateThreadInput {
  workspace: Workspace
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
  list(workspaceId: string, actorId: string, agentIds: readonly string[]): ChatThread[]
  get(id: string): ChatThread | null
  create(input: CreateThreadInput): Promise<ChatThreadResponse>
  detail(thread: ChatThread): ChatThreadResponse
  update(workspace: Workspace, thread: ChatThread, agent: ChatAgent, input: UpdateThreadInput): ChatThreadResponse
  markRead(thread: ChatThread): ChatThread
  /** Models and efforts the agent offers in this workspace; Codex's appear once one of its sessions has run. */
  options(workspace: Workspace, agent: ChatAgent): FamilyOptions
  prompt(thread: ChatThread, text: string, actor: Actor): Promise<ChatThreadPromptResponse>
  cancel(thread: ChatThread): Promise<ChatThreadPromptResponse>
  /** Threads of a workspace agent only: ends the turn and releases what the session holds, as its source allows. */
  close(thread: ChatThread): Promise<ChatThreadCloseResponse>
}

export type { NativeFamilyRunner, NativeFamilyRunners, NativeFamilyTurn }

export interface ThreadServiceOptions {
  now?: () => number
  /** Families prompted here rather than on the session manager's harness path. */
  native?: NativeFamilyRunners
  /** The definitions' workspace agents; their threads start and run through the contributing source. */
  agents: WorkspaceAgentRegistry
  /** The product's `scope.urlPrefix`, for the run.started link. */
  scopeUrlPrefix: string
  scopeLabel: ScopeLabel
}

const BUSY: ReadonlySet<AgentSessionStatus> = new Set(['queued', 'starting', 'prompting'])

export function threadTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= CHAT_THREAD_TITLE_MAX_LENGTH ? flat : `${flat.slice(0, CHAT_THREAD_TITLE_MAX_LENGTH - 1).trimEnd()}…`
}

export function createThreadService(db: Db, sessions: ThreadSessions, options: ThreadServiceOptions): ThreadService {
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

  /** A workspace agent's threads are also created and switched by its source, outside this service. */
  function adopt(thread: ChatThread): ChatThread {
    if (watches.get(thread.id)?.sessionId === thread.currentSessionId) return thread
    watch(thread.id, thread.currentSessionId)
    reconcile(thread.id, false)
    return findThread(db, thread.id) ?? thread
  }

  /** A session its source says has ended (a closed bot thread's released worktree) is replaced by a fresh one on the same thread. */
  async function promptContributed(source: WorkspaceAgentSource, thread: ChatThread, session: AgentSession, text: string): Promise<void> {
    try {
      await source.prompt(session.id, text)
    }
    catch (error) {
      if (!(error instanceof WorkspaceAgentError) || !error.ended) throw error
      await source.start({ agentId: thread.agentId, threadId: thread.id, actorId: thread.actorId })
      const started = findThread(db, thread.id)!.currentSessionId
      watch(thread.id, started)
      await source.prompt(started, text)
    }
  }

  function startSession(workspace: Workspace, actorId: string, agent: ChatAgent, model: string | null, effort: string | null): AgentSession {
    return sessions.create({ workspaceId: workspace.id, family: agent.family, actorId, posture: chatPosture(agent.family, model, effort) })
  }

  function detail(thread: ChatThread): ChatThreadResponse {
    const session = sessionOf(thread)
    const extension = options.agents.ownerOf(session)?.detail(session)
    return { thread, session, sessions: listThreadSessions(db, thread.id), ...(extension === undefined ? {} : { extension }) }
  }
  const reload = (thread: ChatThread): ChatThread => findThread(db, thread.id) ?? thread

  for (const thread of allThreads(db)) {
    reconcile(thread.id, false)
    watch(thread.id, thread.currentSessionId)
  }

  return {
    list: (workspaceId, actorId, agentIds) => listThreads(db, workspaceId, actorId, agentIds).map(adopt),
    get(id) {
      const thread = findThread(db, id)
      return thread && adopt(thread)
    },
    detail,

    async create({ workspace, actorId, agent, title = null, model = null, effort = null, issueIds, signal }) {
      if (agent.source) {
        if (model !== null || effort !== null) throw new ThreadError('invalid_request', `${agent.label} runs with its own posture; model and effort cannot be chosen`)
        const id = randomUUID()
        await agent.source.start({ agentId: agent.id, threadId: id, actorId, signal })
        // The first prompt names the thread, as with any agent; the rail already shows the agent's label.
        updateThread(db, id, { title })
        return detail(adopt(findThread(db, id)!))
      }
      assertModelEffort(agent.family, model, effort, sessions.configOptions(workspace.id, agent.family))
      const session = startSession(workspace, actorId, agent, model, effort)
      const at = now()
      const thread = insertThread(db, {
        id: randomUUID(),
        workspaceId: workspace.id,
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
          workspaceId: workspace.id,
          type: 'run.started',
          title: `${agent.label} run: ${issueIds.join(', ')}`,
          link: chatThreadLink(options.scopeUrlPrefix, workspace.slug, thread.id),
          payload: { threadId: thread.id, agentId: agent.id, sessionId: session.id, issueIds: [...issueIds] },
        })
      }
      return detail(thread)
    },

    update(workspace, thread, agent, input) {
      const at = now()
      const model = input.model === undefined ? thread.model : input.model
      const effort = input.effort === undefined ? thread.effort : input.effort
      const titlePatch = input.title === undefined ? {} : { title: input.title }
      if (model === thread.model && effort === thread.effort) {
        updateThread(db, thread.id, { ...titlePatch, updatedAt: at })
        return detail(reload(thread))
      }
      if (agent.source) throw new ThreadError('invalid_request', `${agent.label} runs with its own posture; model and effort cannot be chosen`)
      if (thread.working || BUSY.has(sessionOf(thread).status)) throw new ThreadError('thread_busy', 'Wait for the turn to end or cancel it before changing the model or effort')
      assertModelEffort(agent.family, model, effort, sessions.configOptions(workspace.id, agent.family), thread)
      const session = startSession(workspace, thread.actorId, agent, model, effort)
      switchThreadSession(db, thread.id, { sessionId: session.id, model, effort, createdAt: at }, { ...titlePatch, model, effort, lastActivityAt: at, updatedAt: at })
      watch(thread.id, session.id)
      return detail(reload(thread))
    },

    options: (workspace, agent) => familyOptions(agent.family, sessions.configOptions(workspace.id, agent.family)),

    markRead(thread) {
      const at = now()
      updateThread(db, thread.id, { unread: false, lastReadAt: at, updatedAt: at })
      return reload(thread)
    },

    async prompt(thread, text, actor) {
      try {
        const session = sessionOf(thread)
        const native = options.native?.[session.family]
        const source = options.agents.ownerOf(session)
        if (native) {
          const workspace = findWorkspaceById(db, thread.workspaceId)
          if (!workspace) throw new ThreadError('not_found', `The ${options.scopeLabel.singular} of thread '${thread.id}' is gone`)
          await sessions.run(session.id, text, turn => native({ ...turn, workspace, actor, thread, session, text }))
        }
        else if (source) {
          await promptContributed(source, thread, session, text)
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
      const source = options.agents.ownerOf(session)
      if (!source) throw new ThreadError('unsupported_agent', 'Only threads of a workspace agent hold anything to close')
      const closed = await source.close(session.id)
      reconcile(thread.id)
      const at = now()
      updateThread(db, thread.id, { unread: false, lastReadAt: at, updatedAt: at })
      return { ...detail(reload(thread)), released: closed?.released ?? false }
    },
  }
}

const services = new WeakMap<ThreadSessions, ThreadService>()

/** One service per session manager, so building the app twice never doubles the session subscriptions. */
export function threadServiceFor(db: Db, sessions: ThreadSessions, options: ThreadServiceOptions): ThreadService {
  let service = services.get(sessions)
  if (!service) {
    service = createThreadService(db, sessions, options)
    services.set(sessions, service)
  }
  return service
}
